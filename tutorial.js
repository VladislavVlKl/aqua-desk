// =============================================
// ТУТОРИАЛ И ПОМОЩЬ
// Добавить в КОНЕЦ app.js (перед последней строкой)
// =============================================

// ─── ДАННЫЕ ТУТОРИАЛА ─────────────────────────

const TUTORIAL_SLIDES = [
  {
    icon: '👋',
    title: 'Добро пожаловать!',
    text: 'Быстрый тур по AquaDesk — займёт минуту.',
    accent: '#7c3aed',
  },
  {
    icon: '🏠',
    title: 'Главная',
    text: 'Здесь два блока: быстрое списание ПТ и запись дежурства. Выбрал клиента, нажал «Списать».',
    accent: '#7c3aed',
  },
  {
    icon: '👥',
    title: 'Клиенты',
    text: 'Список всех твоих клиентов. Нажми на клиента — откроется профиль: абонемент, цели и история занятий с конспектами.',
    accent: '#6d28d9',
  },
  {
    icon: '📝',
    title: 'Конспекты',
    text: 'После каждой ПТ есть 48 часов чтобы написать конспект. Без конспекта не получится списать следующую тренировку этому клиенту.',
    accent: '#a78bfa',
  },
  {
    icon: '📅',
    title: 'Расписание',
    text: 'Недельная сетка с навигацией. Постоянные слоты — каждую неделю. Разовые — на конкретную дату. Ивенты видны прямо в сетке. Нажми на слот чтобы пропустить его или удалить.',
    accent: '#10b981',
  },
  {
    icon: '✅',
    title: 'Сегодня',
    text: 'Занятия из расписания на сегодня. Каждое нужно подтвердить или отменить. Незакрытые → напоминание в 22:00.',
    accent: '#10b981',
  },
  {
    icon: '🔄',
    title: 'Замены и передача',
    text: 'При списании ПТ включи тумблер «На другого тренера» и введи его ФИО — ЗП пойдёт ему, он подтвердит в Отчёте. Для постоянной передачи — в профиле клиента нажми «Передать клиента».',
    accent: '#f59e0b',
  },
  {
    icon: '📊',
    title: 'Отчёт',
    text: 'История ПТ за месяц и расчёт зарплаты. Здесь же принимаешь замены и запросы на передачу клиентов.',
    accent: '#7c3aed',
  },
  {
    icon: '🚀',
    title: 'Всё готово!',
    text: 'Начни с вкладки «Главная». Кнопка ? в углу всегда покажет подсказку.',
    accent: '#7c3aed',
    isLast: true,
  },
];

// ─── ПОКАЗАТЬ ТУТОРИАЛ ────────────────────────

function checkShowTutorial(onDone) {
  const shown = localStorage.getItem('tutorial_v1');
  if (shown) { onDone(); return; }
  showTutorial(onDone);
}

function showTutorial(onDone) {
  let current = 0;

  const overlay = el('div', 'tutorial-overlay');
  overlay.innerHTML = buildTutorialSlide(0);
  document.body.appendChild(overlay);

  // Свайп
  let touchStartX = 0;
  overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -50 && current < TUTORIAL_SLIDES.length - 1) goToSlide(current + 1);
    if (dx >  50 && current > 0)                           goToSlide(current - 1);
  }, {passive:true});

  function goToSlide(n) {
    current = n;
    const inner = overlay.querySelector('.tutorial-inner');
    if (inner) {
      inner.classList.add('slide-out');
      setTimeout(() => {
        overlay.innerHTML = buildTutorialSlide(n);
        bindButtons();
      }, 220);
    }
  }

  function bindButtons() {
    overlay.querySelector('#tut-next')?.addEventListener('click', () => {
      const slide = TUTORIAL_SLIDES[current];
      if (slide.isLast) {
        overlay.remove();
        localStorage.setItem('tutorial_v1', '1');
        onDone();
      } else {
        goToSlide(current + 1);
      }
    });
    overlay.querySelector('#tut-skip')?.addEventListener('click', () => {
      overlay.remove();
      localStorage.setItem('tutorial_v1', '1');
      onDone();
    });
  }

  bindButtons();
}

function buildTutorialSlide(n) {
  const s = TUTORIAL_SLIDES[n];
  const dots = TUTORIAL_SLIDES.map((_, i) =>
    `<span class="tut-dot ${i === n ? 'active' : ''}"></span>`
  ).join('');

  return `
    <div class="tutorial-inner">
      <div class="tut-skip-wrap">
        ${!s.isLast ? `<button id="tut-skip" class="tut-skip">Пропустить</button>` : '<span></span>'}
      </div>
      <div class="tut-icon" style="background:${s.accent}22;color:${s.accent}">${s.icon}</div>
      <div class="tut-dots">${dots}</div>
      <h2 class="tut-title">${s.title}</h2>
      <p class="tut-text">${s.text}</p>
      <button id="tut-next" class="tut-btn" style="background:${s.accent}">
        ${s.isLast ? '✓ Начать работу' : 'Далее →'}
      </button>
    </div>`;
}

// ─── КНОПКА «?» И СПРАВОЧНИК ──────────────────

function renderHelpModal() {
  const role = STATE.profile?.role || 'trainer';
  const m = el('div', 'modal-overlay');

  const sections = [
    {
      title: '📋 Списание ПТ',
      items: [
        'Выбери клиента → тип → дату → «Списать»',
        'Обычная ПТ уменьшает баланс клиента',
        'Разовое (200 000 сум) — ребёнок только 1 раз',
        'В долг — ПТ проведена, но не оплачена в кассе',
        'Максимум 24 часа назад, не раньше',
      ]
    },
    {
      title: '📝 Конспекты',
      items: [
        'После каждой ПТ — 48 часов на запись',
        'Без конспекта нельзя списать след. тренировку этому клиенту',
        'Заходи в профиль клиента → нажми «Написать конспект»',
        'Пиши: что сделали + задача на следующее',
      ]
    },
    {
      title: '✅ Сегодня',
      items: [
        'Занятия из твоего расписания на сегодня',
        'Каждое: «Подтвердить» или «Отменить»',
        'Подтверждение автоматически создаёт запись в журнале',
        'Незакрытые → напоминание в 22:00',
      ]
    },
    {
      title: '⏱ Дежурство',
      items: [
        'Вводи фактическое время начала и конца',
        'Ставка: 14 000 сум/час',
        'Сумма считается автоматически',
      ]
    },
    {
      title: '👤 Клиенты',
      items: [
        'Нажми на клиента в списке → откроется профиль',
        'В профиле: история абонементов, цели, конспекты',
        '+ Начать абонемент — пополняет баланс',
        'Предупреждение ⚠️ — абонемент заканчивается через 7 дней',
      ]
    },
    ...(role === 'admin' || role === 'senior_trainer' ? [{
      title: '📊 Отчёты',
      items: [
        'Сводка — все тренеры за выбранный месяц',
        'Нажми строку → детальный лог тренера',
        'Там же: поставить премию или штраф',
        '⬇️ Скачать Excel — открой в браузере для скачивания',
      ]
    }] : []),
    ...(role === 'admin' ? [{
      title: '🔍 Контроль',
      items: [
        'Долг не подтверждён > 3 дней',
        'Абонементы истекают в ближайшие 7 дней',
        'Дети с повторным разовым',
        'Подозрительные пакетные (> 3 ПТ за раз)',
        'Тренеры без активности в этом месяце',
      ]
    }] : []),
  ];

  m.innerHTML = `
    <div class="modal" style="max-height:85dvh">
      <div class="modal-header">
        <h3>📖 Справочник</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div style="overflow-y:auto;max-height:calc(85dvh - 80px)">
        ${sections.map(s => `
          <div class="help-section">
            <div class="help-title">${s.title}</div>
            <ul class="help-list">
              ${s.items.map(i => `<li>${i}</li>`).join('')}
            </ul>
          </div>`).join('')}
        <div style="text-align:center;padding:16px 0">
          <button class="btn btn-sm" onclick="resetTutorial()">
            ▶ Показать туториал снова
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
}

function resetTutorial() {
  document.querySelector('.modal-overlay')?.remove();
  localStorage.removeItem('tutorial_v1');
  showTutorial(() => enterApp());
}

// ─── ИЗМЕНИТЬ enterApp() ──────────────────────
// ЗАМЕНИ существующую функцию enterApp() на эту:

// enterApp определена в app.js — не переопределяем здесь
