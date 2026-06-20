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
    title: 'Тренировка старше 72 часов',
    text: 'Забыл внести вовремя? Выбери «Старше 72ч — запросить одобрение», укажи причину. Координатор или старший тренер рассмотрит запрос. Тренировка появится в журнале только после одобрения.',
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

// Пошаговые гайды — «Фишки»
function getTips(role) {
  const all = [
    {
      icon: '🆕',
      title: 'Как записать пробную тренировку',
      steps: [
        'Перейди на вкладку «Главная»',
        'В блоке «Списать тренировку» выбери тип → «🆕 Пробная тренировка»',
        'В открывшемся окне введи: Имя (обязательно), Фамилия, Телефон, Возраст',
        'Выбери категорию клиента (1/2/3) — от неё зависит ЗП',
        'Нажми «Записать» — тренировка появится в твоём отчёте',
      ],
      tip: 'ЗП за пробную = ставка разового посещения выбранной категории',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '🏊',
      title: 'Как работать с детской группой',
      steps: [
        'Перейди во вкладку «Группы» → нажми на свою детскую группу',
        'В начале занятия нажми «✅ Отметить посещаемость» — отмечай кто пришёл',
        'Для прошедших дат — кнопка «📅 За другую дату»',
        'Оплата: нажми на имя ребёнка → «💳 Отметить оплату» → введи сумму и период абонемента',
        'Заметки о прогрессе: в том же профиле ребёнка',
      ],
      tip: 'Оплата фиксируется по месяцам. Навигация ‹ › переключает месяц.',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '⏰',
      title: 'Как запросить позднюю тренировку',
      steps: [
        'На «Главная» → тип тренировки → «⏰ Старше 72ч — запросить одобрение»',
        'Выбери клиента из списка',
        'Укажи точную дату и время тренировки',
        'Напиши причину — почему не внёс вовремя (обязательно)',
        'Нажми «Отправить запрос» — уведомление уйдёт координатору',
      ],
      tip: 'Тренировка появится в журнале только после одобрения. Статус запроса виден в твоём «Отчёте».',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '🔄',
      title: 'Как провести замену',
      steps: [
        'При списании ПТ включи переключатель «На другого тренера»',
        'В появившемся поле начни вводить ФИО тренера-замены',
        'Выбери из выпадающего списка',
        'Проведи тренировку как обычно',
        'Тренер-замена увидит запрос в своём «Отчёте» и подтвердит',
      ],
      tip: 'ЗП за замену начисляется тому, кто реально провёл тренировку — после подтверждения.',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '📅',
      title: 'Как вести расписание',
      steps: [
        'Вкладка «Расписание» → кнопка «+ Слот»',
        'Выбери тип: Дежурство / ПТ / Группа',
        'Постоянный — повторяется каждую неделю, можно выбрать несколько дней',
        'Разовый — на конкретную дату (например замещение)',
        'Нажми на слот → «Пропустить» (один раз) или «Удалить навсегда»',
      ],
      tip: 'Вкладка «Сегодня» формируется из расписания — подтверждай каждое занятие.',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '📝',
      title: 'Как писать конспекты',
      steps: [
        'Перейди в «Клиенты» → нажми на клиента',
        'В профиле найди последнюю тренировку без конспекта (значок 📝)',
        'Нажми «Написать конспект»',
        'Заполни «Что делали» — конкретно: упражнения, нагрузка, результат',
        'Заполни «Задача на следующее» — план на след. тренировку',
      ],
      tip: 'Срок — 48 часов после тренировки. Бейдж 📝 в шапке = есть просроченные конспекты.',
      roles: ['trainer','senior_trainer','admin'],
    },
    {
      icon: '💰',
      title: 'Как утвердить ставки по группам (ст. тренер)',
      steps: [
        'Перейди в «Группы» → кнопка «💰 Ставки»',
        'Выбери месяц навигацией ‹ ›',
        'Для каждого тренера укажи тип выплаты: фиксированная сумма или процент',
        'Введи значение и нажми «Сохранить»',
        'После утверждения ЗП тренера пересчитается автоматически',
      ],
      tip: 'Для взрослых групп ставка рассчитывается автоматически по явке (110/120/130к). Ставки нужны только для детских групп.',
      roles: ['senior_trainer','admin'],
    },
    {
      icon: '⏰',
      title: 'Как одобрить позднюю тренировку (ст. тренер)',
      steps: [
        'Перейди в «Ещё» → «⏰ Поздние тренировки»',
        'Читай причину которую указал тренер',
        'Нажми «✓ Одобрить» — тренировка зачтётся в ЗП',
        'Или «✗ Отклонить» — тренировка не появится',
      ],
      tip: 'Красная кнопка в «Ещё» появляется когда есть новые запросы.',
      roles: ['senior_trainer','admin'],
    },
    {
      icon: '🔗',
      title: 'Как отправить расписание в ОП (координатор)',
      steps: [
        'Перейди в «Ещё» → прокрути вниз до «Ссылки расписания для ОП»',
        'Найди нужный филиал и нажми «📋 Копировать»',
        'Вставь ссылку в сообщение ОП',
        'ОП увидит расписание только своего филиала, редактировать не сможет',
      ],
      tip: 'Ссылка постоянная — обновляется автоматически каждые 5 минут.',
      roles: ['admin'],
    },
    {
      icon: '📊',
      title: 'Как скачать Excel с ЗП (координатор)',
      steps: [
        'Перейди в «Аналитика» → выбери месяц и филиал',
        'Нажми кнопку «⬇️ [Название филиала]»',
        'Если открыто в Telegram — нажми «Открыть в браузере»',
        'В браузере файл скачается автоматически',
        'Файл содержит: Ведомость, Взрослые ГП и листы по каждому тренеру',
      ],
      tip: 'Детские ГП — отдельная выгрузка из раздела «Группы» → кнопка «⬇️ Дет.ГП».',
      roles: ['senior_trainer','admin'],
    },
  ];
  return all.filter(t => t.roles.includes(role));
}

function renderHelpModal(activeTab='ref') {
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
        'Вносить можно за последние 72 часа',
      ]
    },
    {
      title: '⏰ Тренировка старше 72 часов',
      items: [
        'Выбери «Старше 72ч — запросить одобрение»',
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
        'Детские ГП — кнопка «⬇️ Дет.ГП» в разделе Группы',
      ]
    }] : []),
    ...(role === 'senior_trainer' ? [{
      title: '⏰ Поздние тренировки',
      items: [
        'Раздел Ещё → «⏰ Поздние тренировки»',
        'Тренер прислал запрос на тренировку старше 72 часов',
        'Одобри или отклони',
      ]
    }] : []),
    ...(role === 'admin' ? [{
      title: '🔍 Контроль',
      items: [
        '⏰ Запросы на поздние тренировки — одобрить/отклонить',
        '🆕 Пробные за месяц — список + алерт если ≥5 у одного тренера',
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

  const tips = getTips(role);

  const tabStyle = (t) => t === activeTab
    ? 'font-weight:700;border-bottom:2px solid var(--accent);color:var(--accent);padding:8px 16px;cursor:pointer;background:none;border-top:none;border-left:none;border-right:none;font-size:14px;font-family:inherit'
    : 'font-weight:400;border-bottom:2px solid transparent;color:var(--hint);padding:8px 16px;cursor:pointer;background:none;border-top:none;border-left:none;border-right:none;font-size:14px;font-family:inherit';

  m.innerHTML = `
    <div class="modal" style="max-height:85dvh">
      <div class="modal-header">
        <h3>📖 Помощь</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:4px">
        <button style="${tabStyle('ref')}" onclick="this.closest('.modal-overlay').remove();renderHelpModal('ref')">Справочник</button>
        <button style="${tabStyle('tips')}" onclick="this.closest('.modal-overlay').remove();renderHelpModal('tips')">✨ Фишки (${tips.length})</button>
      </div>
      <div style="overflow-y:auto;max-height:calc(85dvh - 110px)">
        ${activeTab === 'ref' ? `
          ${sections.map(s => `
            <div class="help-section">
              <div class="help-title">${s.title}</div>
              <ul class="help-list">
                ${s.items.map(i => `<li>${i}</li>`).join('')}
              </ul>
            </div>`).join('')}
        ` : `
          ${tips.map(t => `
            <div style="margin-bottom:16px;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
              <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)">
                <span style="font-size:22px">${t.icon}</span>
                <span style="font-weight:700;font-size:14px">${t.title}</span>
              </div>
              <div style="padding:12px 14px">
                <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
                  ${t.steps.map(s => `<li style="font-size:13px;line-height:1.5">${s}</li>`).join('')}
                </ol>
                <div style="margin-top:10px;background:rgba(124,58,237,.08);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;padding:8px 10px;font-size:12px;color:var(--hint)">
                  💡 ${t.tip}
                </div>
              </div>
            </div>`).join('')}
        `}
        <div style="text-align:center;padding:12px 0">
          <button class="btn btn-sm" onclick="resetTutorial();this.closest('.modal-overlay')?.remove()">
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
