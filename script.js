(() => {
  const SUPABASE_FUNCTION_URL =
    'https://bqxslcwujyfuhsyzbsdn.supabase.co/functions/v1/analyze-food';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable__aq7GLlwntvQ_e1XTyZ1Jg_JsZVhcxV';
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
      storage.set('weight-logs', logs);
      weightInput.value = '';
      render();
      toast('晨重已保存');
    });
    window.addEventListener('resize', renderChart);
    render();
  }

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
    const zone = $('#uploadZone');
    const preview = $('#foodPreview');
    const placeholder = $('#scanPlaceholder');
    const action = $('#scanAction');
    const result = $('#scanResult');
    const formCard = $('#scanFormCard');
    let imageDataUrl = '';

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

    foodPhoto.addEventListener('change', async () => {
      const file = foodPhoto.files?.[0];
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
      } catch (error) {
        imageDataUrl = '';
        foodPhoto.value = '';
        const message = error instanceof Error ? error.message : '图片处理失败';
        result.innerHTML = `<span class="metric-label">无法读取</span><h3>请换一张照片</h3><p class="metric-note">${escapeHtml(message)}</p>`;
        toast(message);
      }
    });

    action?.addEventListener('click', async () => {
      if (!imageDataUrl) {
        toast('请先选择一张餐食照片');
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
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
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
        const formNumber = value => Number.isFinite(Number(value)) ? Number(value) : '';

        $('#mealName').value = typeof analysis.mealName === 'string' ? analysis.mealName.slice(0, 40) : '';
        $('#mealCalories').value = formNumber(total.calories);
        $('#mealProtein').value = formNumber(total.protein);
        $('#mealCarbs').value = formNumber(total.carbs);
        $('#mealFat').value = formNumber(total.fat);
        $('#mealNoteInput').value = typeof analysis.note === 'string'
          ? analysis.note.slice(0, 80)
          : 'AI 估算仅供参考，请按实际份量调整';

        const foodNames = Array.isArray(analysis.items)
          ? analysis.items.map(item => item?.name).filter(Boolean).slice(0, 5).join('、')
          : '';
        const mealTitle = typeof analysis.mealName === 'string' ? analysis.mealName : '识别完成';
        result.innerHTML = `
          <span class="metric-label">识别完成</span>
          <h3>${escapeHtml(mealTitle)}</h3>
          <p class="metric-note">${foodNames ? `识别到：${escapeHtml(foodNames)}` : '请在下方确认结果'}</p>
          <p class="metric-note">约 ${escapeHtml(total.calories ?? '—')} kcal · 蛋白质 ${escapeHtml(total.protein ?? '—')} g</p>`;

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

    $('#mealForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const name = $('#mealName').value.trim();
      const calories = Number($('#mealCalories').value);
      const protein = Number($('#mealProtein').value);
      if (!name || !Number.isFinite(calories) || !Number.isFinite(protein)) return;
      const meals = getMeals();
      meals.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        date: todayKey,
        createdAt: new Date().toISOString(),
        name,
        type: $('#mealType').value,
        calories,
        protein,
        carbs: Number($('#mealCarbs').value || 0),
        fat: Number($('#mealFat').value || 0),
        note: $('#mealNoteInput').value.trim(),
        source: 'confirmed-scan'
      });
      storage.set('meal-logs', meals);
      toast('已记入今天');
      window.setTimeout(() => { window.location.href = 'index.html#numbers-title'; }, 450);
    });
  }
})();
