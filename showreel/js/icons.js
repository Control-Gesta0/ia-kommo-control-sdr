// Ícones genéricos (traço 24x24, estilo linha). Nenhum logo de terceiros.
(function () {
  const S = (inner, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const F = inner => `<svg viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;
  const I = {
    spark: F('<path d="M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0z"/>'),
    chat: S('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>'),
    check: S('<polyline points="20 6 9 17 4 12"/>', 3),
    checkCircle: S('<circle cx="12" cy="12" r="10"/><polyline points="16.5 8.5 10.5 15 7.5 12"/>'),
    kanban: S('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 7v8M12 7v4M16 7v10"/>'),
    search: S('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>'),
    calendar: S('<rect x="3" y="4.5" width="18" height="17" rx="3"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    bell: S('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    contract: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M7.5 17.5c1.2-2.2 2.2-2.2 2.8 0 .6 2 1.6 2 3-.4"/><line x1="8" y1="11" x2="14" y2="11"/>'),
    coin: S('<circle cx="12" cy="12" r="9.5"/><path d="M15 9.3c-.5-.9-1.6-1.4-3-1.4-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.4M12 5.8v2.1M12 16.1v2.1"/>'),
    chart: S('<line x1="5" y1="20" x2="5" y2="14"/><line x1="10" y1="20" x2="10" y2="9"/><line x1="15" y1="20" x2="15" y2="12"/><line x1="20" y1="20" x2="20" y2="5"/>', 2.6),
    receipt: S('<path d="M5 2.5v19l2.3-1.4 2.3 1.4 2.4-1.4 2.3 1.4 2.4-1.4 2.3 1.4v-19l-2.3 1.4-2.4-1.4-2.3 1.4-2.4-1.4-2.3 1.4z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
    clock: S('<circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.5 14"/>'),
    task: S('<polyline points="9 11 12 14 21 5"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/>'),
    video: S('<polygon points="22.5 7 16 12 22.5 17 22.5 7"/><rect x="1.5" y="5" width="14.5" height="14" rx="2.5"/>'),
    mic: S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10.5v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18.5" x2="12" y2="22"/>'),
    play: F('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>'),
    arrow: S('<line x1="4" y1="12" x2="20" y2="12"/><polyline points="13 5 20 12 13 19"/>', 2.4),
    refresh: S('<polyline points="22 4 22 10 16 10"/><polyline points="2 20 2 14 8 14"/><path d="M4.6 9A8.5 8.5 0 0 1 18.4 6L22 10M2 14l3.6 4A8.5 8.5 0 0 0 19.4 15"/>'),
    pen: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    card: S('<rect x="1.5" y="4.5" width="21" height="15" rx="2.5"/><line x1="1.5" y1="9.5" x2="22.5" y2="9.5"/><line x1="5.5" y1="15" x2="9.5" y2="15"/>'),
    pix: S('<rect x="7" y="7" width="10" height="10" rx="2.2" transform="rotate(45 12 12)"/><path d="M9.2 12h5.6"/>'),
    db: S('<ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M20.5 12c0 1.7-3.8 3-8.5 3s-8.5-1.3-8.5-3"/><path d="M3.5 5v14c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5"/>'),
    link: S('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    user: S('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    file: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    zap: F('<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>'),
    send: S('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
    alert: S('<circle cx="12" cy="12" r="9.5"/><line x1="12" y1="7.5" x2="12" y2="12.5"/><circle cx="12" cy="16.3" r=".6" fill="currentColor"/>'),
    plug: S('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>'),
    stamp: S('<path d="M8.5 13.5V11a3.5 3.5 0 1 1 7 0v2.5"/><rect x="4" y="13.5" width="16" height="4" rx="1.2"/><line x1="5" y1="21" x2="19" y2="21"/>'),
    trend: S('<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>'),
    dots: F('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
    dblcheck: S('<polyline points="1.5 12.5 6 17 15.5 7"/><polyline points="9 15 11 17 22.5 6"/>'),
  };
  window.ICON = (name, cls = '', style = '') => `<span class="ico ${cls}" style="${style}">${I[name]}</span>`;
  window.ICONS = I;
})();
