// =============================================
// ТУТОРИАЛ И ПОМОЩЬ — v2
// =============================================

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
    text: 'Два блока: быстрое списание ПТ и запись дежурства. Выбрал клиента → тип → дату → «Списать».',
    accent: '#7c3aed',
  },
  {
    icon: '🎯',
    title: 'Типы тренировок',
    text: 'Обычная ПТ — списывает баланс. Разовые — три варианта по категории (1к/2к/3к). Пробная — для новых клиентов без абонемента. В долг — ПТ без оплаты, нужно подтвердить позже.',
    accent: '#10b981',
  },
  {
    icon: '🆕',
    title: 'Пробная тренировка',
    text: 'Клиент пришёл впервые? Выбери «Пробная» — введи имя, телефон, категорию. ЗП начисляется как за разовое посещение. Координатор видит все пробные в разделе «Контроль».',
    accent: '#8b5cf6',
  },
  {
    icon: '⏰',
    title: 'Тренировка старше 48 часов',
    text: 'Забыл внести вовремя? Выбери «Старше 48ч — запросить одобрение», укажи причину. Координатор или старший тренер рассмотрит запрос. Тренировка появится в журнале только после одобрения.',
    accent: '#f59e0b',
  },
  {
    icon: '📝',
    title: 'Конспекты',
    text: 'После каждой ПТ есть 48 часов на конспект. Открой профиль клиента → «Написать конспект». Пиши: что сделали + задача на следующую тренировку.',
    accent: '#a78bfa',
  },
  {
    icon: '📅',
    title: 'Расписание',
    text: 'Недельная сетка. Постоянные слоты — каждую неделю. Разовые — на конкретную дату. Нажми на слот чтобы пропустить (только этот день) или удалить насовсем.',
    accent: '#10b981',
  },
  {
    icon: '✅',
    title: 'Сегодня',
    text: 'Занятия из расписания на сегодня. Каждое нужно подтвердить или отменить. Подтверждение создаёт запись в журнале автоматически.',
    accent: '#10b981',
  },
  {
    icon: '🔄',
    title: 'Замены',
    text: 'При списании ПТ включи «На другого тренера» и введи его ФИО — ЗП пойдёт ему. Тренер подтвердит в своём Отчёте. Для постоянной передачи клиента — в профиле клиента «Передать клиента».',
    accent: '#f59e0b',
  },
  {
    icon: '📊',
    title: 'Отчёт',
    text: 'История ПТ, разовых, пробных и дежурств за месяц. Здесь же принимаешь замены и запросы на передачу клиентов. Кнопка Excel — скачай в браузере.',
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

const TUTORIAL_VERSION = 'tutorial_v2';

function checkShowTutorial(onDone) {
  const shown = localStorage.getItem(TUTORIAL_VERSION);
  if (shown) { onDone(); return; }
  showTutorial(onDone);
}

function showTutorial(onDone) {
  let current = 0;

  const overlay = el('div', 'tutorial-overlay');
  overlay.innerHTML = buildTutorialSlide(0);
  document.body.appendChild(overlay);

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
        localStorage.setItem(TUTORIAL_VERSION, '1');
        onDone();
      } else {
        goToSlide(current + 1);
      }
    });
    overlay.querySelector('#tut-skip')?.addEventListener('click', () => {
      overlay.remove();
      localStorage.setItem(TUTORIAL_VERSION, '1');
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
        'Обычная ПТ уменьшает баланс клиента на 1',
        'Разовые: 1кт (85 000), 2кт (110 000), 3кт (135 000) — ребёнок только 1 раз',
        '🆕 Пробная — для новых клиентов без абонемента, ЗП как за разовое',
        'В долг — ПТ без оплаты, нужно подтвердить позже',
        'Вносить можно за последние 48 часов',
      ]
    },
    {
      title: '⏰ Тренировка старше 48 часов',
      items: [
        'Выбери «Старше 48ч — запросить одобрение»',
        'Укажи причину — почему не внёс вовремя',
        'Запрос уходит координатору / старшему тренеру',
        'Тренировка появляется в журнале только после одобрения',
      ]
    },
    {
      title: '📝 Конспекты',
      items: [
        'После каждой ПТ — 48 часов на запись конспекта',
        'Заходи в профиль клиента → «Написать конспект»',
        'Пиши: что сделали + задача на следующую тренировку',
      ]
    },
    {
      title: '✅ Сегодня',
      items: [
        'Занятия из твоего расписания на сегодня',
        'Каждое: «Подтвердить» или «Отменить»',
        'Подтверждение создаёт запись в журнале автоматически',
      ]
    },
    {
      title: '⏱ Дежурство',
      items: [
        'Вводи фактическое время начала и конца',
        'Ставка: 14 000 сум/час',
        'Дежурство можно редактировать или удалить',
      ]
    },
    {
      title: '👤 Клиенты',
      items: [
        'Нажми на клиента → откроется профиль',
        'В профиле: история абонементов, цели, конспекты',
        '+ Начать абонемент — пополняет баланс',
        'Предупреждение ⚠️ — абонемент заканчивается через 7 дней',
        'Пакеты: 5/10/25 ПТ для взрослых, +50 ПТ для детей',
      ]
    },
    {
      title: '🔄 Замены',
      items: [
        'При списании включи «На другого тренера»',
        'Введи ФИО тренера — ЗП пойдёт ему',
        'Он подтвердит в своём Отчёте',
        'Постоянная передача клиента — в профиле клиента',
      ]
    },
    ...(role === 'admin' || role === 'senior_trainer' ? [{
      title: '📊 Отчёты и ЗП',
      items: [
        'Сводка — все тренеры за выбранный месяц',
        'Нажми строку → детальный лог: ПТ, разовые, пробные, дежурства',
        'Премия / Штраф — ставится в детальном отчёте тренера',
        '⬇️ Excel — открой в браузере для скачивания',
        'Детские ГП — кнопка в разделе Группы',
      ]
    }] : []),
    ...(role === 'senior_trainer' ? [{
      title: '⏰ Поздние тренировки',
      items: [
        'Раздел Ещё → «Поздние тренировки»',
        'Тренер прислал запрос на тренировку старше 48 часов',
        'Одобри или отклони с комментарием',
      ]
    }] : []),
    ...(role === 'admin' ? [{
      title: '🔍 Контроль',
      items: [
        '⏰ Запросы на поздние тренировки — одобрить/отклонить',
        '🆕 Пробные за месяц — список + алерт если у тренера ≥5',
        '📋 Активность тренеров — ПТ за месяц, просроченные конспекты',
        '❗ Долг не подтверждён > 3 дней',
        '⚠️ Абонементы истекают в ближайшие 7 дней',
        '🗑 Запросы на удаление клиентов',
      ]
    }] : []),
    ...(role === 'admin' ? [{
      title: '🔗 Расписание для ОП',
      items: [
        'Раздел Ещё → внизу «Ссылки расписания для ОП»',
        'Скопируй ссылку на нужный филиал и отправь в ОП',
        'Ссылка только для просмотра — редактировать нельзя',
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
  localStorage.removeItem(TUTORIAL_VERSION);
  showTutorial(() => enterApp());
}

// enterApp определена в app.js
