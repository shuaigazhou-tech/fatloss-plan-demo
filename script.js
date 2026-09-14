(() => {
  const SUPABASE_URL = 'https://bqxslcwujyfuhsyzbsdn.supabase.co';
  const SUPABASE_FUNCTION_URL =
    'https://bqxslcwujyfuhsyzbsdn.supabase.co/functions/v1/analyze-food';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable__aq7GLlwntvQ_e1XTyZ1Jg_JsZVhcxV';
  let supabaseClient = null;
  let currentSession = null;
  let suppressCloudSync = false;
  let cloudWriteChain = Promise.resolve();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  const storage = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
      if (!suppressCloudSync) queueCloudSync(key, value);
    },
    has(key) {
      try { return localStorage.getItem(key) !== null; } catch { return false; }
    }
  };

  const toggle = $('.nav-toggle');
  const nav = $('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const toast = (message) => {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => el.classList.remove('show'), 1800);
  };

  const remoteMealToLocal = row => ({
    id: row.client_ref,
    date: row.eaten_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    type: row.meal_type,
    calories: Number(row.calories),
    protein: Number(row.protein),
    carbs: Number(row.carbs),
    fat: Number(row.fat),
    note: row.note || '',
    source: row.source || 'manual',
    items: Array.isArray(row.items) ? row.items : []
  });
  const localMealToRemote = (meal, userId) => ({
    user_id: userId,
    client_ref: meal.id,
    eaten_on: meal.date,
    name: String(meal.name || '未命名餐食').slice(0, 80),
    meal_type: meal.type || '午餐',
    calories: Number(meal.calories || 0),
    protein: Number(meal.protein || 0),
    carbs: Number(meal.carbs || 0),
    fat: Number(meal.fat || 0),
    note: String(meal.note || '').slice(0, 300),
    source: meal.source || 'manual',
    items: Array.isArray(meal.items) ? meal.items : [],
    created_at: meal.createdAt || new Date().toISOString(),
    updated_at: meal.updatedAt || new Date().toISOString()
  });
  const remoteFavoriteToLocal = row => ({
    id: row.client_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    type: row.meal_type,
    calories: Number(row.calories),
    protein: Number(row.protein),
    carbs: Number(row.carbs),
    fat: Number(row.fat),
    note: row.note || '',
    items: Array.isArray(row.items) ? row.items : []
  });
  const localFavoriteToRemote = (meal, userId) => ({
    user_id: userId,
    client_ref: meal.id,
    name: String(meal.name || '常用餐食').slice(0, 80),
    meal_type: meal.type || '午餐',
    calories: Number(meal.calories || 0),
    protein: Number(meal.protein || 0),
    carbs: Number(meal.carbs || 0),
    fat: Number(meal.fat || 0),
    note: String(meal.note || '').slice(0, 300),
    items: Array.isArray(meal.items) ? meal.items : [],
    created_at: meal.createdAt || new Date().toISOString(),
    updated_at: meal.updatedAt || new Date().toISOString()
  });

  const mergeByKey = (remote, local, key) => {
    const merged = new Map(remote.map(item => [item[key], item]));
    local.forEach(item => {
      const previous = merged.get(item[key]);
      const previousTime = Date.parse(previous?.updatedAt || previous?.createdAt || 0);
      const itemTime = Date.parse(item.updatedAt || item.createdAt || 0);
      if (!previous || !Number.isFinite(previousTime) || itemTime >= previousTime) merged.set(item[key], item);
    });
    return [...merged.values()];
  };

  async function replaceRemoteRows(table, keyColumn, rows, mapper) {
    if (!currentSession || !supabaseClient) return;
    const userId = currentSession.user.id;
    const { data: existing, error: readError } = await supabaseClient.from(table).select(keyColumn);
    if (readError) throw readError;
    const localIds = new Set(rows.map(item => String(item.id ?? item.date)));
    const stale = (existing || []).map(row => String(row[keyColumn])).filter(id => !localIds.has(id));
    if (stale.length) {
      const { error } = await supabaseClient.from(table).delete().in(keyColumn, stale);
      if (error) throw error;
    }
    if (rows.length) {
      const { error } = await supabaseClient.from(table).upsert(rows.map(item => mapper(item, userId)), {
        onConflict: table === 'weight_logs' ? 'user_id,weighed_on' : 'user_id,client_ref'
      });
      if (error) throw error;
    }
  }

  async function syncKeyToCloud(key, value) {
    if (!currentSession || !supabaseClient) return;
    const userId = currentSession.user.id;
    if (key === 'meal-logs') {
      await replaceRemoteRows('meal_logs', 'client_ref', Array.isArray(value) ? value : [], localMealToRemote);
    } else if (key === 'weight-logs') {
      const rows = Array.isArray(value) ? value : [];
      await replaceRemoteRows('weight_logs', 'weighed_on', rows, (item, uid) => ({
        user_id: uid, weighed_on: item.date, weight: Number(item.weight), updated_at: item.updatedAt || new Date().toISOString()
      }));
    } else if (key === 'favorite-meals') {
      await replaceRemoteRows('favorite_meals', 'client_ref', Array.isArray(value) ? value : [], localFavoriteToRemote);
    } else if (key.startsWith('checklist-')) {
      const date = key.slice('checklist-'.length);
      const updatedAt = storage.get(`daily-updated-${date}`, new Date().toISOString());
      const { error } = await supabaseClient.from('daily_logs').upsert({
        user_id: userId,
        log_date: date,
        checklist: Array.isArray(value) ? value : [],
        workout_done: storage.get(`workout-done-${date}`, false),
        updated_at: updatedAt
      }, { onConflict: 'user_id,log_date' });
      if (error) throw error;
    } else if (key.startsWith('workout-done-')) {
      const date = key.slice('workout-done-'.length);
      const updatedAt = storage.get(`daily-updated-${date}`, new Date().toISOString());
      const { error } = await supabaseClient.from('daily_logs').upsert({
        user_id: userId,
        log_date: date,
        checklist: storage.get(`checklist-${date}`, []),
        workout_done: Boolean(value),
        updated_at: updatedAt
      }, { onConflict: 'user_id,log_date' });
      if (error) throw error;
    }
  }

  function queueCloudSync(key, value) {
    if (!currentSession || !['meal-logs', 'weight-logs', 'favorite-meals'].includes(key) && !key.startsWith('checklist-') && !key.startsWith('workout-done-')) return;
    cloudWriteChain = cloudWriteChain
      .then(() => syncKeyToCloud(key, value))
      .then(() => setSyncStatus('已同步', 'success'))
      .catch(error => {
        console.error('云端同步失败', error);
        setSyncStatus('等待同步', 'warning');
      });
  }

  const setSyncStatus = (label, state = '') => {
    const status = $('#syncStatus');
    if (!status) return;
    status.textContent = label;
    status.dataset.state = state;
  };

  const injectAuthShell = () => {
    const navWrap = $('.nav-wrap');
    if (!navWrap || $('#authTrigger')) return;
    navWrap.insertAdjacentHTML('beforeend', `
      <div class="auth-slot"><button class="auth-trigger" id="authTrigger" type="button"><span class="sync-dot"></span><span id="authTriggerText">登录同步</span></button></div>
      <dialog class="auth-dialog" id="authDialog" aria-labelledby="authTitle">
        <button class="dialog-close" id="closeAuthDialog" type="button" aria-label="关闭">×</button>
        <div id="signedOutPanel">
          <span class="eyebrow">跨设备同步</span><h2 id="authTitle">登录「刚刚好」</h2>
          <p class="metric-note">登录后，餐食、体重、打卡、训练和收藏会自动同步。</p>
          <form id="authForm" class="auth-form">
            <label class="field">邮箱<input id="authEmail" type="email" autocomplete="email" required placeholder="name@example.com"></label>
            <label class="field">密码<input id="authPassword" type="password" autocomplete="current-password" minlength="6" required placeholder="至少 6 位"></label>
            <button class="button" type="submit">登录并同步</button>
            <button class="button secondary" id="signUpAction" type="button">创建账号</button>
          </form>
          <p class="form-message" id="authMessage" role="status"></p>
        </div>
        <div id="signedInPanel" hidden>
          <span class="eyebrow">云端已连接</span><h2>数据同步中</h2>
          <p class="account-email" id="accountEmail"></p>
          <div class="sync-panel"><span class="sync-dot"></span><div><strong id="syncStatus">已同步</strong><small>数据在登录设备间保持一致</small></div></div>
          <div class="dialog-actions"><button class="button" id="syncNowAction" type="button">立即同步</button><button class="button secondary" id="signOutAction" type="button">退出登录</button></div>
        </div>
      </dialog>`);
  };

  const updateAuthUI = () => {
    const signedIn = Boolean(currentSession?.user);
    $('#signedOutPanel')?.toggleAttribute('hidden', signedIn);
    $('#signedInPanel')?.toggleAttribute('hidden', !signedIn);
    const text = $('#authTriggerText');
    if (text) text.textContent = signedIn ? '已同步' : '登录同步';
    const trigger = $('#authTrigger');
    trigger?.classList.toggle('signed-in', signedIn);
    const email = $('#accountEmail');
    if (email) email.textContent = currentSession?.user?.email || '';
  };

  async function syncAllData({ notify = false } = {}) {
    if (!currentSession || !supabaseClient) return false;
    setSyncStatus('同步中…');
    const [mealsResult, weightsResult, dailyResult, favoritesResult] = await Promise.all([
      supabaseClient.from('meal_logs').select('*').order('eaten_on'),
      supabaseClient.from('weight_logs').select('*').order('weighed_on'),
      supabaseClient.from('daily_logs').select('*').order('log_date'),
      supabaseClient.from('favorite_meals').select('*').order('updated_at', { ascending: false })
    ]);
    const firstError = [mealsResult, weightsResult, dailyResult, favoritesResult].find(result => result.error)?.error;
    if (firstError) throw firstError;

    const before = JSON.stringify({
      meals: storage.get('meal-logs', []), weights: storage.get('weight-logs', []), favorites: storage.get('favorite-meals', [])
    });
    const localMeals = storage.get('meal-logs', []);
    const localWeights = storage.get('weight-logs', []);
    const localFavorites = storage.get('favorite-meals', []);
    const remoteMeals = (mealsResult.data || []).map(remoteMealToLocal);
    const remoteWeights = (weightsResult.data || []).map(row => ({ date: row.weighed_on, weight: Number(row.weight), updatedAt: row.updated_at }));
    const remoteFavorites = (favoritesResult.data || []).map(remoteFavoriteToLocal);
    const mergedMeals = mergeByKey(remoteMeals, localMeals, 'id');
    const mergedWeights = mergeByKey(remoteWeights, localWeights, 'date');
    const mergedFavorites = mergeByKey(remoteFavorites, localFavorites, 'id');

    suppressCloudSync = true;
    storage.set('meal-logs', mergedMeals);
    storage.set('weight-logs', mergedWeights);
    storage.set('favorite-meals', mergedFavorites);
    (dailyResult.data || []).forEach(row => {
      const checklistKey = `checklist-${row.log_date}`;
      const workoutKey = `workout-done-${row.log_date}`;
      const localUpdated = Date.parse(storage.get(`daily-updated-${row.log_date}`, ''));
      const remoteUpdated = Date.parse(row.updated_at || '');
      const useRemote = !storage.has(checklistKey) || !Number.isFinite(localUpdated) || remoteUpdated > localUpdated;
      if (useRemote) {
        storage.set(checklistKey, row.checklist || []);
        storage.set(workoutKey, Boolean(row.workout_done));
        storage.set(`daily-updated-${row.log_date}`, row.updated_at);
      }
    });
    suppressCloudSync = false;

    await Promise.all([
      syncKeyToCloud('meal-logs', mergedMeals),
      syncKeyToCloud('weight-logs', mergedWeights),
      syncKeyToCloud('favorite-meals', mergedFavorites)
    ]);
    const dailyKeys = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('checklist-') || key?.startsWith('workout-done-')) dailyKeys.push(key);
      }
    } catch { /* private mode */ }
    await Promise.all(dailyKeys.map(key => syncKeyToCloud(key, storage.get(key, key.startsWith('checklist-') ? [] : false))));
    setSyncStatus('已同步', 'success');
    if (notify) toast('云端数据已同步');
    const after = JSON.stringify({ meals: mergedMeals, weights: mergedWeights, favorites: mergedFavorites });
    return before !== after;
  }

  async function initializeAuth() {
    injectAuthShell();
    const dialog = $('#authDialog');
    $('#authTrigger')?.addEventListener('click', () => dialog?.showModal());
    $('#closeAuthDialog')?.addEventListener('click', () => dialog?.close());
    dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

    if (!window.supabase?.createClient) {
      $('#authTriggerText').textContent = '仅本机';
      return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    updateAuthUI();

    $('#authForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const message = $('#authMessage');
      message.textContent = '正在登录…';
      const { error } = await supabaseClient.auth.signInWithPassword({ email: $('#authEmail').value.trim(), password: $('#authPassword').value });
      message.textContent = error ? `登录失败：${error.message}` : '登录成功，正在同步…';
    });
    $('#signUpAction')?.addEventListener('click', async () => {
      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;
      const message = $('#authMessage');
      if (!email || password.length < 6) { message.textContent = '请填写邮箱和至少 6 位密码。'; return; }
      message.textContent = '正在创建账号…';
      const { data: signUpData, error } = await supabaseClient.auth.signUp({ email, password });
      message.textContent = error ? `注册失败：${error.message}` : signUpData.session ? '注册成功，正在同步…' : '注册成功，请先到邮箱确认，再回来登录。';
    });
    $('#signOutAction')?.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      dialog?.close();
      toast('已退出，当前数据仍保留在本机');
    });
    $('#syncNowAction')?.addEventListener('click', async () => {
      try { await syncAllData({ notify: true }); }
      catch (error) { console.error(error); setSyncStatus('同步失败', 'warning'); toast('同步失败，请稍后重试'); }
    });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      const changedUser = currentSession?.user?.id !== session?.user?.id;
      currentSession = session;
      updateAuthUI();
      if (session && changedUser) window.setTimeout(async () => {
        try {
          const changed = await syncAllData({ notify: true });
          dialog?.close();
          if (changed) window.location.reload();
        } catch (error) {
          console.error(error);
          setSyncStatus('同步失败', 'warning');
          toast('登录成功，但云端表尚未配置或同步失败');
        }
      }, 0);
    });

    if (currentSession) {
      try {
        const changed = await syncAllData();
        if (changed) window.location.reload();
      } catch (error) {
        console.error(error);
        setSyncStatus('同步失败', 'warning');
      }
    }
  }

  const localDateKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const todayKey = localDateKey();
  const checklist = $('#dailyChecklist');
  if (checklist) {
    let saved = storage.get(`checklist-${todayKey}`, []);
    const boxes = $$('input[type="checkbox"]', checklist);
    if (storage.get(`workout-done-${todayKey}`, false) && !saved.includes(3)) {
      saved.push(3);
      storage.set(`checklist-${todayKey}`, saved);
    }
    boxes.forEach((box, index) => {
      box.checked = saved.includes(index);
      box.addEventListener('change', () => {
        const done = boxes.map((b, i) => b.checked ? i : null).filter(v => v !== null);
        storage.set(`daily-updated-${todayKey}`, new Date().toISOString());
        storage.set(`checklist-${todayKey}`, done);
        updateChecklist();
      });
    });
    function updateChecklist() {
      const done = boxes.filter(b => b.checked).length;
      const score = $('#checkScore');
      const bar = $('#checkBar');
      if (score) score.textContent = `${done} / ${boxes.length}`;
      if (bar) bar.style.width = `${(done / boxes.length) * 100}%`;
    }
    updateChecklist();
  }

  const getMeals = () => storage.get('meal-logs', []).filter(meal => meal && meal.id && meal.date);
  const getFavorites = () => storage.get('favorite-meals', []).filter(meal => meal && meal.id && meal.name);
  const makeClientId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const addFavorite = meal => {
    const favorites = getFavorites();
    const normalizedName = String(meal.name || '').trim().toLocaleLowerCase();
    const existing = favorites.find(item => item.name.trim().toLocaleLowerCase() === normalizedName);
    const favorite = {
      id: existing?.id || makeClientId(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: meal.name,
      type: meal.type || '午餐',
      calories: Number(meal.calories || 0),
      protein: Number(meal.protein || 0),
      carbs: Number(meal.carbs || 0),
      fat: Number(meal.fat || 0),
      note: meal.note || '',
      items: Array.isArray(meal.items) ? meal.items : []
    };
    const next = existing ? favorites.map(item => item.id === existing.id ? favorite : item) : [favorite, ...favorites];
    storage.set('favorite-meals', next);
    return favorite;
  };
  const logFavoriteToday = favorite => {
    const meals = getMeals();
    meals.push({ ...favorite, id: makeClientId(), date: todayKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'favorite' });
    storage.set('meal-logs', meals);
    toast(`已将「${favorite.name}」记入今天`);
  };
  const renderDailyNutrition = () => {
    const calorieEl = $('#todayCalories');
    if (!calorieEl) return;
    const calorieGoal = 1550;
    const proteinGoal = 110;
    const meals = getMeals().filter(meal => meal.date === todayKey);
    const calories = Math.round(meals.reduce((sum, meal) => sum + Number(meal.calories || 0), 0));
    const protein = Math.round(meals.reduce((sum, meal) => sum + Number(meal.protein || 0), 0) * 10) / 10;
    const caloriePct = Math.round(calories / calorieGoal * 100);
    const proteinPct = Math.round(protein / proteinGoal * 100);
    calorieEl.textContent = calories;
    $('#todayProtein').textContent = protein.toFixed(protein % 1 ? 1 : 0);
    $('#caloriePercent').textContent = `${caloriePct}%`;
    $('#proteinPercent').textContent = `${proteinPct}%`;
    $('#calorieBar').style.width = `${Math.min(100, caloriePct)}%`;
    $('#proteinBar').style.width = `${Math.min(100, proteinPct)}%`;
    const calorieRemaining = calorieGoal - calories;
    const proteinRemaining = Math.max(0, proteinGoal - protein);
    $('#calorieRemain').textContent = calorieRemaining >= 0 ? `今天还可安排约 ${calorieRemaining} kcal` : `比参考值高约 ${Math.abs(calorieRemaining)} kcal`;
    $('#proteinRemain').textContent = proteinRemaining > 0 ? `今天还差约 ${Math.ceil(proteinRemaining)} g` : '今天的蛋白质目标已完成';
    $('#mealCount').textContent = meals.length;
    $('#dashboardDate').textContent = `${new Date().getMonth() + 1}月${new Date().getDate()}日`;

    let advice = '先记录第一顿，建议会随进度更新。';
    if (meals.length && calorieRemaining <= 0) advice = '今天已接近参考上限。下一餐按饥饿程度正常吃，优先清淡蛋白质和蔬菜，不需要补偿性节食。';
    else if (meals.length && proteinRemaining > 35) advice = `蛋白质还差约 ${Math.ceil(proteinRemaining)} g。下一餐优先鸡肉、牛肉、鱼虾、鸡蛋或豆腐。`;
    else if (meals.length && calorieRemaining < 400) advice = '剩余热量不多，下一餐选少油蛋白质和两份蔬菜，主食按饥饿程度留小份。';
    else if (meals.length) advice = '目前节奏刚好。下一餐继续按“蛋白质 + 两份菜 + 一份主食”搭配。';
    $('#nextMealAdvice').textContent = advice;

    const list = $('#todayMealList');
    list.innerHTML = meals.length ? meals.map(meal => `
      <div class="meal-log-row">
        <div><strong>${escapeHtml(meal.name)}</strong><small>${escapeHtml(meal.type)}${meal.note ? ` · ${escapeHtml(meal.note)}` : ''}</small></div>
        <div><strong>${Math.round(meal.calories)} kcal</strong><small>${Number(meal.protein).toFixed(1)} g 蛋白质</small></div>
        <button class="icon-button" type="button" data-delete-meal="${escapeHtml(meal.id)}" aria-label="删除 ${escapeHtml(meal.name)}">删除</button>
      </div>`).join('') : '<p class="metric-note">还没有餐食记录。拍一张照片或手动填入识别结果吧。</p>';
    $$('[data-delete-meal]', list).forEach(button => button.addEventListener('click', () => {
      const updated = getMeals().filter(meal => meal.id !== button.dataset.deleteMeal);
      storage.set('meal-logs', updated);
      renderDailyNutrition();
      toast('餐食已删除');
    }));
  };
  renderDailyNutrition();

  const macroSliders = $$('.macro-slider');
  if (macroSliders.length) {
    const updateMacros = () => {
      let sum = 0;
      macroSliders.forEach(slider => {
        const out = $(`[data-output="${slider.id}"]`);
        const value = Number(slider.value);
        sum += value;
        if (out) out.textContent = `${value} kcal`;
      });
      const total = $('#mealTotal');
      if (total) total.textContent = `${sum} kcal`;
      const note = $('#mealNote');
      if (note) {
        note.textContent = sum < 1500 ? '略低：可以给正餐或加餐补一点。' : sum > 1600 ? '略高：先从酱料、饮料或主食份量微调。' : '刚好落在你的 1500–1600 kcal 起始区间。';
      }
    };
    macroSliders.forEach(s => s.addEventListener('input', updateMacros));
    updateMacros();
  }

  const tabs = $$('.tab-list [role="tab"]');
  if (tabs.length) {
    tabs.forEach(tab => tab.addEventListener('click', () => {
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      $$('.workout-panel').forEach(p => p.classList.remove('active'));
      tab.setAttribute('aria-selected', 'true');
      const panel = $(`#${tab.getAttribute('aria-controls')}`);
      panel?.classList.add('active');
      storage.set('training-days', tab.dataset.days);
    }));
    const selected = storage.get('training-days', '4');
    $(`[data-days="${selected}"]`)?.click();
  }

  $$('.workout-panel').forEach(panel => {
    $$('.day-card', panel).forEach((card, index) => {
      const heading = $('h3', card);
      if (!heading) return;
      heading.setAttribute('role', 'button');
      heading.setAttribute('tabindex', '0');
      const setState = open => {
        card.classList.toggle('collapsed', !open);
        heading.setAttribute('aria-expanded', String(open));
      };
      setState(index === 0);
      const toggleCard = () => setState(card.classList.contains('collapsed'));
      heading.addEventListener('click', toggleCard);
      heading.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCard(); }
      });
    });
  });

  const workoutButton = $('#workoutComplete');
  if (workoutButton) {
    const row = $('#workoutCheckRow');
    const renderWorkoutStatus = () => {
      const done = storage.get(`workout-done-${todayKey}`, false);
      row?.classList.toggle('done', done);
      workoutButton.textContent = done ? '✓ 今日已完成' : '标记今日完成';
      workoutButton.classList.toggle('secondary', done);
      workoutButton.setAttribute('aria-pressed', String(done));
    };
    workoutButton.addEventListener('click', () => {
      const done = !storage.get(`workout-done-${todayKey}`, false);
      storage.set(`daily-updated-${todayKey}`, new Date().toISOString());
      storage.set(`workout-done-${todayKey}`, done);
      renderWorkoutStatus();
      toast(done ? '训练完成，做得刚刚好' : '已取消完成状态');
    });
    renderWorkoutStatus();
  }

  const weightForm = $('#weightForm');
  if (weightForm) {
    const dateInput = $('#weightDate');
    const weightInput = $('#weightValue');
    if (dateInput) dateInput.value = todayKey;

    let logs = storage.get('weight-logs', []);
    const normalize = () => logs.sort((a, b) => a.date.localeCompare(b.date));

    const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

    const renderChart = () => {
      const canvas = $('#weightChart');
      const empty = $('#chartEmpty');
      if (!canvas) return;
      if (!logs.length) {
        canvas.hidden = true;
        if (empty) empty.hidden = false;
        return;
      }
      canvas.hidden = false;
      if (empty) empty.hidden = true;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(300, rect.width * dpr);
      canvas.height = Math.max(220, rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const pad = { l: 42, r: 18, t: 18, b: 34 };
      const visible = logs.slice(-30);
      const values = visible.map(x => x.weight);
      const min = Math.min(55, ...values) - .8;
      const max = Math.max(63, ...values) + .8;
      const x = i => pad.l + (visible.length === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (visible.length - 1));
      const y = v => pad.t + (max - v) * (h - pad.t - pad.b) / (max - min);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '12px system-ui';
      ctx.fillStyle = '#7b8580';
      ctx.strokeStyle = '#dce2db';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const v = max - i * (max - min) / 3;
        const yy = y(v);
        ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
        ctx.fillText(v.toFixed(1), 3, yy + 4);
      }
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#edae8e';
      ctx.beginPath(); ctx.moveTo(pad.l, y(55)); ctx.lineTo(w - pad.r, y(55)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#486758';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      visible.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.weight)) : ctx.moveTo(x(i), y(p.weight)));
      ctx.stroke();
      visible.forEach((p, i) => {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#486758'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x(i), y(p.weight), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      const first = visible[0].date.slice(5);
      const last = visible.at(-1).date.slice(5);
      ctx.fillStyle = '#7b8580';
      ctx.fillText(first, pad.l, h - 8);
      ctx.textAlign = 'right'; ctx.fillText(last, w - pad.r, h - 8); ctx.textAlign = 'left';
    };

    const renderLogs = () => {
      normalize();
      const list = $('#weightLogList');
      if (list) {
        list.innerHTML = logs.length ? [...logs].reverse().map(item => `
          <div class="log-row">
            <time datetime="${item.date}">${item.date}</time>
            <strong>${item.weight.toFixed(1)} kg</strong>
            <button type="button" data-delete="${item.date}" aria-label="删除 ${item.date} 的记录">删除</button>
          </div>`).join('') : '<p class="metric-note">还没有记录，从今天的晨重开始吧。</p>';
        $$('[data-delete]', list).forEach(btn => btn.addEventListener('click', () => {
          logs = logs.filter(x => x.date !== btn.dataset.delete);
          storage.set('weight-logs', logs);
          render();
        }));
      }
      const current = logs.at(-1)?.weight ?? 63;
      const progress = Math.max(0, Math.min(100, ((63 - current) / 8) * 100));
      const currentEl = $('#currentWeight');
      const remainEl = $('#remainingWeight');
      const progressEl = $('#weightProgress');
      if (currentEl) currentEl.textContent = `${current.toFixed(1)} kg`;
      if (remainEl) remainEl.textContent = `${Math.max(0, current - 55).toFixed(1)} kg`;
      if (progressEl) progressEl.textContent = `${Math.round(progress)}%`;

      const last7 = logs.slice(-7).map(x => x.weight);
      const prev7 = logs.slice(-14, -7).map(x => x.weight);
      const avg = average(last7);
      const prev = average(prev7);
      const avgEl = $('#sevenDayAvg');
      if (avgEl) avgEl.textContent = avg ? `${avg.toFixed(1)} kg` : '—';
      const insight = $('#trendInsight');
      if (insight) {
        if (!avg) insight.textContent = '记录 7 次左右后，这里会用均值帮你过滤单日波动。';
        else if (!prev) insight.textContent = `最近记录均值是 ${avg.toFixed(1)} kg。继续记录，满两周后可比较趋势。`;
        else {
          const change = avg - prev;
          if (change <= -.7) insight.textContent = `周均下降 ${Math.abs(change).toFixed(1)} kg，速度偏快；若明显饥饿或力量下降，可每天增加 100–150 kcal。`;
          else if (change <= -.2) insight.textContent = `周均下降 ${Math.abs(change).toFixed(1)} kg，正处于建议区间，保持当前计划。`;
          else if (change < .2) insight.textContent = '两周均值接近。先继续观察到 2–3 周，并检查经期、盐分和执行情况。';
          else insight.textContent = `周均上升 ${change.toFixed(1)} kg。先检查经期与短期水分波动，不根据一周数据立刻砍热量。`;
        }
      }
    };

    const render = () => { renderLogs(); window.requestAnimationFrame(renderChart); };
    weightForm.addEventListener('submit', event => {
      event.preventDefault();
      const date = dateInput.value;
      const weight = Number(weightInput.value);
      if (!date || !Number.isFinite(weight) || weight < 40 || weight > 100) return;
      logs = logs.filter(x => x.date !== date);
      logs.push({ date, weight });
      logs = logs.map(item => item.date === date ? { ...item, updatedAt: new Date().toISOString() } : item);
      storage.set('weight-logs', logs);
      weightInput.value = '';
      render();
      toast('晨重已保存');
    });
    window.addEventListener('resize', renderChart);
    render();
  }

  const renderWeeklyReport = () => {
    if (!$('#weeklyCalories')) return;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const startKey = localDateKey(start);
    const endKey = localDateKey(end);
    const meals = getMeals().filter(meal => meal.date >= startKey && meal.date <= endKey);
    const weights = storage.get('weight-logs', []).filter(item => item.date >= startKey && item.date <= endKey).sort((a, b) => a.date.localeCompare(b.date));
    const mealDays = new Map();
    meals.forEach(meal => {
      const current = mealDays.get(meal.date) || { calories: 0, protein: 0 };
      current.calories += Number(meal.calories || 0);
      current.protein += Number(meal.protein || 0);
      mealDays.set(meal.date, current);
    });
    const days = [...mealDays.values()];
    const avgCalories = days.length ? days.reduce((sum, day) => sum + day.calories, 0) / days.length : null;
    const avgProtein = days.length ? days.reduce((sum, day) => sum + day.protein, 0) / days.length : null;
    let workouts = 0;
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (storage.get(`workout-done-${localDateKey(cursor)}`, false)) workouts += 1;
    }
    const weightChange = weights.length >= 2 ? Number(weights.at(-1).weight) - Number(weights[0].weight) : null;
    const completeness = Math.round(Math.min(100, (mealDays.size + new Set(weights.map(item => item.date)).size) / 14 * 100));
    $('#weeklyRange').textContent = `${startKey.slice(5)} 至 ${endKey.slice(5)}`;
    $('#weeklyCalories').textContent = avgCalories === null ? '—' : `${Math.round(avgCalories)} kcal`;
    $('#weeklyProtein').textContent = avgProtein === null ? '—' : `${Math.round(avgProtein)} g`;
    $('#weeklyWeightChange').textContent = weightChange === null ? '—' : `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`;
    $('#weeklyWorkouts').textContent = `${workouts} 次`;
    $('#weeklyScore').textContent = `${completeness}%`;
    let advice = '先记录几天餐食和晨重，周报会更准确。';
    if (days.length >= 3 && avgProtein < 90) advice = '这周蛋白质偏少。下一周每天固定安排一份高蛋白早餐或加餐。';
    else if (days.length >= 3 && avgCalories > 1750) advice = '记录日的平均热量略高。优先减少饮料、酱料或一小份主食，不需要跳过正餐。';
    else if (weightChange !== null && weightChange < -.8) advice = '本周下降偏快。若疲劳或训练表现下降，适当增加 100–150 kcal。';
    else if (days.length >= 3 && workouts >= 3) advice = '饮食与训练记录都在形成节奏。保持一周，再结合两周体重均值判断。';
    else if (days.length >= 3) advice = '饮食记录已经起步；下周争取完成 3 次训练或恢复日活动。';
    $('#weeklyAdvice').textContent = advice;
  };
  renderWeeklyReport();

  const renderMealHistory = () => {
    const historyList = $('#mealHistoryList');
    if (!historyList) return;
    const search = ($('#historySearch')?.value || '').trim().toLocaleLowerCase();
    const type = $('#historyType')?.value || '全部';
    const date = $('#historyDate')?.value || '';
    const allMeals = [...getMeals()].sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
    const filtered = allMeals.filter(meal => {
      const haystack = `${meal.name} ${meal.note || ''}`.toLocaleLowerCase();
      return (!search || haystack.includes(search)) && (type === '全部' || meal.type === type) && (!date || meal.date === date);
    });
    $('#historyCount').textContent = `${filtered.length} 条`;
    historyList.innerHTML = filtered.length ? filtered.map(meal => `
      <article class="card history-card">
        <div class="history-main"><time datetime="${escapeHtml(meal.date)}">${escapeHtml(meal.date)}</time><h3>${escapeHtml(meal.name)}</h3><p>${escapeHtml(meal.type)} · ${Math.round(meal.calories)} kcal · 蛋白质 ${Number(meal.protein || 0).toFixed(1)} g</p>${meal.note ? `<small>${escapeHtml(meal.note)}</small>` : ''}</div>
        <div class="history-actions"><button class="button ghost small" type="button" data-favorite-history="${escapeHtml(meal.id)}">收藏</button><button class="button secondary small" type="button" data-reuse-history="${escapeHtml(meal.id)}">记到今天</button><button class="icon-button" type="button" data-delete-history="${escapeHtml(meal.id)}">删除</button></div>
      </article>`).join('') : '<div class="empty-state card"><p>没有符合条件的餐食记录。</p></div>';
    $$('[data-favorite-history]', historyList).forEach(button => button.addEventListener('click', () => {
      const meal = allMeals.find(item => item.id === button.dataset.favoriteHistory);
      if (meal) { addFavorite(meal); renderFavorites(); toast('已加入常用餐食'); }
    }));
    $$('[data-reuse-history]', historyList).forEach(button => button.addEventListener('click', () => {
      const meal = allMeals.find(item => item.id === button.dataset.reuseHistory);
      if (meal) logFavoriteToday(meal);
    }));
    $$('[data-delete-history]', historyList).forEach(button => button.addEventListener('click', () => {
      storage.set('meal-logs', getMeals().filter(item => item.id !== button.dataset.deleteHistory));
      renderMealHistory();
      toast('餐食记录已删除');
    }));
  };

  const renderFavorites = () => {
    const favorites = getFavorites();
    const fullList = $('#favoriteMealList');
    const quickList = $('#favoriteQuickList');
    const card = meal => `<article class="favorite-card"><div><strong>${escapeHtml(meal.name)}</strong><span>${escapeHtml(meal.type)} · ${Math.round(meal.calories)} kcal · ${Number(meal.protein || 0).toFixed(1)} g 蛋白质</span></div><div><button class="button small" type="button" data-log-favorite="${escapeHtml(meal.id)}">记入今天</button>${fullList ? `<button class="icon-button" type="button" data-delete-favorite="${escapeHtml(meal.id)}">删除</button>` : ''}</div></article>`;
    if (fullList) fullList.innerHTML = favorites.length ? favorites.map(card).join('') : '<p class="metric-note">还没有收藏。可从历史记录或识餐结果中添加。</p>';
    if (quickList) quickList.innerHTML = favorites.length ? favorites.slice(0, 4).map(card).join('') : '<p class="metric-note">收藏常吃餐食后，可以直接记入今天。</p>';
    $$('[data-log-favorite]').forEach(button => button.addEventListener('click', () => {
      const meal = favorites.find(item => item.id === button.dataset.logFavorite);
      if (meal) logFavoriteToday(meal);
    }));
    $$('[data-delete-favorite]').forEach(button => button.addEventListener('click', () => {
      storage.set('favorite-meals', favorites.filter(item => item.id !== button.dataset.deleteFavorite));
      renderFavorites();
      toast('已移除收藏');
    }));
  };

  ['historySearch', 'historyType', 'historyDate'].forEach(id => $(`#${id}`)?.addEventListener(id === 'historySearch' ? 'input' : 'change', renderMealHistory));
  $('#clearHistoryFilters')?.addEventListener('click', () => {
    $('#historySearch').value = ''; $('#historyType').value = '全部'; $('#historyDate').value = ''; renderMealHistory();
  });
  renderMealHistory();
  renderFavorites();

  const filters = $$('.filter-bar button');
  if (filters.length) {
    filters.forEach(btn => btn.addEventListener('click', () => {
      filters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.dataset.filter;
      $$('.takeout-card').forEach(card => card.hidden = category !== '全部' && card.dataset.category !== category);
    }));
  }

  $$('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      toast('备注已复制');
    } catch {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove(); toast('备注已复制');
    }
  }));

  const foodPhoto = $('#foodPhoto');
  if (foodPhoto) {
    const cameraPhoto = $('#cameraPhoto');
    const zone = $('#uploadZone');
    const preview = $('#foodPreview');
    const placeholder = $('#scanPlaceholder');
    const action = $('#scanAction');
    const result = $('#scanResult');
    const formCard = $('#scanFormCard');
    let imageDataUrl = '';
    let currentItems = [];

    const cleanNumber = value => Math.max(0, Number(value) || 0);
    const renderItemEditor = () => {
      const editor = $('#mealItemEditor');
      if (!editor) return;
      editor.innerHTML = currentItems.length ? currentItems.map((item, index) => `
        <div class="meal-item-row" data-item-index="${index}">
          <label>食物<input data-item-field="name" value="${escapeHtml(item.name || '')}" placeholder="食物名称"></label>
          <label>份量<input data-item-field="amount" value="${escapeHtml(item.amount || '')}" placeholder="约 1 份"></label>
          <label>热量<input data-item-field="calories" type="number" min="0" step="1" value="${cleanNumber(item.calories)}"></label>
          <label>蛋白质<input data-item-field="protein" type="number" min="0" step="0.1" value="${cleanNumber(item.protein)}"></label>
          <label>碳水<input data-item-field="carbs" type="number" min="0" step="0.1" value="${cleanNumber(item.carbs)}"></label>
          <label>脂肪<input data-item-field="fat" type="number" min="0" step="0.1" value="${cleanNumber(item.fat)}"></label>
          <button class="icon-button remove-item" data-remove-item="${index}" type="button" aria-label="删除食物">删除</button>
        </div>`).join('') : '<p class="metric-note">还没有食物明细，可点击“添加食物”。</p>';
      $$('[data-item-field]', editor).forEach(input => input.addEventListener('input', () => {
        const row = input.closest('[data-item-index]');
        const item = currentItems[Number(row.dataset.itemIndex)];
        const field = input.dataset.itemField;
        item[field] = ['calories', 'protein', 'carbs', 'fat'].includes(field) ? cleanNumber(input.value) : input.value;
        updateTotalsFromItems();
      }));
      $$('[data-remove-item]', editor).forEach(button => button.addEventListener('click', () => {
        currentItems.splice(Number(button.dataset.removeItem), 1);
        renderItemEditor();
        updateTotalsFromItems();
      }));
    };

    const updateTotalsFromItems = () => {
      if (!currentItems.length) return;
      const total = field => currentItems.reduce((sum, item) => sum + cleanNumber(item[field]), 0);
      $('#mealCalories').value = Math.round(total('calories'));
      $('#mealProtein').value = total('protein').toFixed(1);
      $('#mealCarbs').value = total('carbs').toFixed(1);
      $('#mealFat').value = total('fat').toFixed(1);
    };
    $('#addMealItem')?.addEventListener('click', () => {
      currentItems.push({ name: '', amount: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
      renderItemEditor();
    });

    const prepareImage = file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
      reader.onload = () => {
        const original = String(reader.result || '');
        const image = new Image();
        image.onerror = () => {
          if (/^data:image\/(?:jpeg|jpg|png|gif|webp);base64,/i.test(original)) resolve(original);
          else reject(new Error('暂不支持这种图片格式，请改用 JPG 或 PNG'));
        };
        image.onload = () => {
          const maxEdge = 1280;
          const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('图片处理失败，请重新选择'));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .82));
        };
        image.src = original;
      };
      reader.readAsDataURL(file);
    });

    const handleSelectedPhoto = async input => {
      const file = input.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;

      action.disabled = true;
      action.style.opacity = '.45';
      result.innerHTML = '<span class="metric-label">正在准备</span><h3>处理照片中…</h3><p class="metric-note">会自动压缩后再识别。</p>';

      try {
        imageDataUrl = await prepareImage(file);
        preview.src = imageDataUrl;
        preview.hidden = false;
        placeholder.hidden = true;
        zone.classList.add('has-image');
        action.disabled = false;
        action.style.opacity = '1';
        result.innerHTML = '<span class="metric-label">照片已就绪</span><h3>可以开始识别</h3><p class="metric-note">AI 会先估算，你确认后再保存。</p>';
        if ($('#autoScan')?.checked) window.setTimeout(() => action.click(), 120);
      } catch (error) {
        imageDataUrl = '';
        input.value = '';
        const message = error instanceof Error ? error.message : '图片处理失败';
        result.innerHTML = `<span class="metric-label">无法读取</span><h3>请换一张照片</h3><p class="metric-note">${escapeHtml(message)}</p>`;
        toast(message);
      }
    };
    foodPhoto.addEventListener('change', () => handleSelectedPhoto(foodPhoto));
    cameraPhoto?.addEventListener('change', () => handleSelectedPhoto(cameraPhoto));
    $('#cameraAction')?.addEventListener('click', () => cameraPhoto?.click());
    $('#galleryAction')?.addEventListener('click', () => foodPhoto.click());

    action?.addEventListener('click', async () => {
      if (!imageDataUrl) {
        toast('请先选择一张餐食照片');
        return;
      }
      if (!currentSession?.access_token) {
        toast('请先登录后再使用 AI 识餐');
        $('#authDialog')?.showModal();
        return;
      }

      action.disabled = true;
      action.style.opacity = '.65';
      action.textContent = 'AI 正在识别…';
      result.innerHTML = '<span class="metric-label">正在识别</span><h3>分析这顿饭中…</h3><p class="metric-note">通常只需要几秒。</p>';

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 75000);

      try {
        const response = await fetch(SUPABASE_FUNCTION_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${currentSession.access_token}`
          },
          body: JSON.stringify({ imageDataUrl })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '餐食识别失败，请稍后再试');

        const payloadObject = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        const analysis = payloadObject.result && typeof payloadObject.result === 'object'
          ? payloadObject.result
          : payloadObject;
        const total = analysis.total && typeof analysis.total === 'object' ? analysis.total : {};
        const quotaInfo = payloadObject.quota && typeof payloadObject.quota === 'object' ? payloadObject.quota : null;
        const quotaText = quotaInfo && Number.isFinite(Number(quotaInfo.used)) && Number.isFinite(Number(quotaInfo.quota))
          ? ` · 今日 ${Number(quotaInfo.used)}/${Number(quotaInfo.quota)} 次`
          : '';
        const formNumber = value => Number.isFinite(Number(value)) ? Number(value) : '';

        currentItems = Array.isArray(analysis.items) ? analysis.items.slice(0, 20).map(item => ({
          name: String(item?.name || '').slice(0, 60),
          amount: String(item?.amount || '').slice(0, 40),
          calories: cleanNumber(item?.calories),
          protein: cleanNumber(item?.protein),
          carbs: cleanNumber(item?.carbs),
          fat: cleanNumber(item?.fat)
        })) : [];
        renderItemEditor();

        $('#mealName').value = typeof analysis.mealName === 'string' ? analysis.mealName.slice(0, 40) : '';
        $('#mealCalories').value = formNumber(total.calories);
        $('#mealProtein').value = formNumber(total.protein);
        $('#mealCarbs').value = formNumber(total.carbs);
        $('#mealFat').value = formNumber(total.fat);
        if (currentItems.length) updateTotalsFromItems();
        $('#mealNoteInput').value = typeof analysis.note === 'string'
          ? analysis.note.slice(0, 80)
          : 'AI 估算仅供参考，请按实际份量调整';

        const foodNames = currentItems.length
          ? currentItems.map(item => item.name).filter(Boolean).slice(0, 5).join('、')
          : '';
        const mealTitle = typeof analysis.mealName === 'string' ? analysis.mealName : '识别完成';
        result.innerHTML = `
          <span class="metric-label">识别完成</span>
          <h3>${escapeHtml(mealTitle)}</h3>
          <p class="metric-note">${foodNames ? `识别到：${escapeHtml(foodNames)}` : '请在下方确认结果'}</p>
          <p class="metric-note">约 ${escapeHtml(total.calories ?? '—')} kcal · 蛋白质 ${escapeHtml(total.protein ?? '—')} g${escapeHtml(quotaText)}</p>`;

        formCard.hidden = false;
        formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('识别完成，请确认份量');
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'AbortError';
        const message = timedOut
          ? '识别超时，请重试'
          : error instanceof Error ? error.message : '餐食识别失败';
        result.innerHTML = `<span class="metric-label">识别失败</span><h3>再试一次</h3><p class="metric-note">${escapeHtml(message)}</p>`;
        toast(message);
      } finally {
        window.clearTimeout(timeoutId);
        action.disabled = false;
        action.style.opacity = '1';
        action.textContent = '开始 AI 识别';
      }
    });

    const scanPrompt = '请识别这张餐食照片中的食物和大致份量，估算总热量、蛋白质、碳水和脂肪，并说明估算误差。请用简洁列表返回，方便我确认后记录。';
    $('#copyScanPrompt')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(scanPrompt); toast('识餐提示词已复制'); }
      catch { toast('复制失败，请手动复制'); }
    });

    const mealFromForm = () => {
      const name = $('#mealName').value.trim();
      const calories = Number($('#mealCalories').value);
      const protein = Number($('#mealProtein').value);
      if (!name || !Number.isFinite(calories) || !Number.isFinite(protein)) return null;
      return {
        name,
        type: $('#mealType').value,
        calories,
        protein,
        carbs: Number($('#mealCarbs').value || 0),
        fat: Number($('#mealFat').value || 0),
        note: $('#mealNoteInput').value.trim(),
        items: currentItems.filter(item => item.name.trim()).map(item => ({ ...item }))
      };
    };

    $('#saveAsFavorite')?.addEventListener('click', () => {
      const meal = mealFromForm();
      if (!meal) { toast('请先填写餐食名称和营养数据'); return; }
      addFavorite(meal);
      renderFavorites();
      toast('已保存为常用餐食');
    });

    $('#mealForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const meal = mealFromForm();
      if (!meal) return;
      const meals = getMeals();
      meals.push({
        id: makeClientId(),
        date: todayKey,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...meal,
        source: 'confirmed-scan'
      });
      storage.set('meal-logs', meals);
      toast('已记入今天');
      window.setTimeout(() => { window.location.href = 'index.html#numbers-title'; }, 450);
    });
  }
  initializeAuth();
})();
