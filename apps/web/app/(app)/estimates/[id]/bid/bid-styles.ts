// Scoped stylesheet for the Bid Estimator workspace. Mirrors the approved
// frontend reference (B-Visible-Bid-Estimator-Demo.html): navy step rail,
// white cards on a light-gray canvas, orange accents, status pill colors
// (green auto / yellow check / blue office / red blocked / gray pending),
// guide cards, calculators, the customer-ready estimate sheet and the QBME
// panel. Everything is namespaced under `.bidw` so nothing leaks into the
// rest of the app; the app shell's own sidebar stays untouched.

export function bidWorkspaceCss(): string {
  return `
.bidw {
  --navy: #143e68; --navy-2: #0e2f50; --navy-3: #1f527e;
  --orange: #f57c1f; --orange-soft: #fff2e8;
  --ink: #183047; --muted: #66798b; --line: #dbe4ec; --line-strong: #c7d4df;
  --bg: #f4f7fa; --white: #ffffff;
  --green: #198754; --green-soft: #eaf8f1; --amber: #b56b00; --amber-soft: #fff7e4;
  --blue-soft: #edf5fc; --red: #b74545; --red-soft: #fdeeee;
  --shadow: 0 10px 30px rgba(23,53,81,.08); --radius: 16px;
  color: var(--ink); background: var(--bg); min-height: 100vh; font-size: 14px; line-height: 1.5;
}
.bidw *, .bidw *::before, .bidw *::after { box-sizing: border-box; }
.bidw button, .bidw input, .bidw select, .bidw textarea { font: inherit; color: inherit; }
.bidw button { cursor: pointer; }
.bidw button:disabled { cursor: not-allowed; opacity: .55; }
.bidw a { color: inherit; }
.bidw-shell { display: grid; grid-template-columns: 264px minmax(0, 1fr); min-height: 100vh; }
.bidw-side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--navy-2); color: var(--white); padding: 22px 16px 18px; overflow-y: auto; }
.bidw-brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 20px; border-bottom: 1px solid rgba(255,255,255,.12); text-decoration: none; }
.bidw-mark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; background: var(--white); color: var(--navy); font-weight: 900; letter-spacing: -2px; box-shadow: inset 0 -3px 0 var(--orange); flex: 0 0 40px; }
.bidw-brand-name { display: block; font-weight: 800; letter-spacing: .08em; font-size: 14px; }
.bidw-brand-sub { display: block; margin-top: 2px; color: #b9c9d8; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
.bidw-chip { margin: 18px 6px 12px; padding: 11px 12px; border-radius: 12px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.08); }
.bidw-chip span { display: block; color: #aebfd0; font-size: 10px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
.bidw-chip strong { display: block; margin-top: 4px; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bidw-chip small { display: block; margin-top: 2px; color: #b9c9d8; font-size: 11px; }
.bidw-steps { display: grid; gap: 5px; margin-top: 4px; }
.bidw-step { width: 100%; display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px; padding: 10px; border: 0; border-radius: 11px; background: transparent; color: #c9d6e2; text-align: left; transition: background .18s ease, color .18s ease; }
.bidw-step:hover { background: rgba(255,255,255,.07); color: var(--white); }
.bidw-step.active { background: var(--white); color: var(--navy-2); }
.bidw-step:focus-visible, .bidw .btn:focus-visible, .bidw .choice:focus-visible, .bidw summary:focus-visible, .bidw .input:focus-visible { outline: 3px solid rgba(245,124,31,.4); outline-offset: 2px; }
.bidw-step-num { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 50%; border: 1px solid rgba(255,255,255,.23); font-size: 12px; font-weight: 800; }
.bidw-step.active .bidw-step-num { border-color: var(--orange); background: var(--orange); color: var(--white); }
.bidw-step-name { font-size: 13px; font-weight: 650; }
.bidw-step-check { color: #65d99b; font-size: 13px; font-weight: 800; }
.bidw-step.active .bidw-step-check { color: var(--green); }
.bidw-step-dot { width: 8px; height: 8px; border-radius: 50%; background: #f5b26b; }
.bidw-side-foot { margin-top: auto; padding: 16px 8px 0; color: #afbfce; font-size: 11px; line-height: 1.5; }
.bidw-side-foot strong { color: var(--white); }
.bidw-side-foot a { color: #dfe8f0; text-decoration: underline; }
.bidw-main { min-width: 0; }
.bidw-top { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 28px; background: var(--white); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
.bidw-crumb { color: var(--muted); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bidw-crumb strong { color: var(--ink); }
.bidw-crumb a { text-decoration: none; }
.bidw-crumb a:hover { text-decoration: underline; }
.bidw-top-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.bidw-save { display: inline-flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 999px; font-size: 11px; font-weight: 750; border: 1px solid var(--line); background: #f8fafc; color: var(--muted); }
.bidw-save .dot { width: 7px; height: 7px; border-radius: 50%; background: #9fb4c7; }
.bidw-save.saved { border-color: #cfe9d9; background: var(--green-soft); color: var(--green); } .bidw-save.saved .dot { background: var(--green); }
.bidw-save.saving { border-color: #f5d3b9; background: var(--orange-soft); color: #975019; } .bidw-save.saving .dot { background: var(--orange); animation: bidw-pulse 1s infinite; }
.bidw-save.dirty { border-color: #f1e2c0; background: var(--amber-soft); color: var(--amber); } .bidw-save.dirty .dot { background: var(--amber); }
.bidw-save.failed { border-color: #f1c9c9; background: var(--red-soft); color: var(--red); } .bidw-save.failed .dot { background: var(--red); }
.bidw-save button { border: 0; background: transparent; text-decoration: underline; padding: 0; font-weight: 750; color: inherit; }
@keyframes bidw-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.bidw-profile { display: flex; align-items: center; gap: 9px; padding-left: 12px; border-left: 1px solid var(--line); }
.bidw-avatar { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: var(--navy); color: var(--white); font-size: 11.5px; font-weight: 800; }
.bidw-profile-copy strong, .bidw-profile-copy span { display: block; }
.bidw-profile-copy strong { font-size: 12px; } .bidw-profile-copy span { margin-top: 1px; color: var(--muted); font-size: 10px; }
.bidw-content { max-width: 1510px; margin: 0 auto; padding: 26px 28px 56px; }
.bidw-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 20px; }
.bidw-eyebrow { margin: 0 0 6px; color: var(--orange); font-size: 11px; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }
.bidw h1 { margin: 0; color: var(--navy-2); font-size: clamp(24px, 2.6vw, 32px); line-height: 1.15; letter-spacing: -.025em; font-weight: 800; }
.bidw-desc { max-width: 760px; margin: 8px 0 0; color: var(--muted); font-size: 13.5px; }
.bidw-actions { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; }
.bidw .btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px; border: 1px solid transparent; border-radius: 10px; font-size: 12.5px; font-weight: 750; text-decoration: none; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; white-space: nowrap; }
.bidw .btn:hover:not(:disabled) { transform: translateY(-1px); }
.bidw .btn-primary { background: var(--navy); color: var(--white); box-shadow: 0 5px 14px rgba(20,62,104,.18); }
.bidw .btn-primary:hover:not(:disabled) { background: var(--navy-3); }
.bidw .btn-orange { background: var(--orange); color: var(--white); }
.bidw .btn-secondary { border-color: var(--line-strong); background: var(--white); color: var(--navy); }
.bidw .btn-quiet { border-color: var(--line); background: #f8fafc; color: var(--muted); }
.bidw .btn-danger { border-color: #f1c9c9; background: var(--red-soft); color: var(--red); }
.bidw .btn-sm { min-height: 30px; padding: 4px 10px; font-size: 11.5px; border-radius: 8px; }
.bidw-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
/* Wide layout for data-dense steps (the pricing table): the table takes the
   full width and the guidance sits beside it only on very wide screens. */
.bidw-layout-wide { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
@media (min-width: 1700px) { .bidw-layout-wide { grid-template-columns: minmax(0, 1fr) 320px; } }
@media (max-width: 1699px) { .bidw-layout-wide .guide { position: static; } }
.bidw-stack { display: grid; gap: 16px; min-width: 0; }
.bidw .card { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); min-width: 0; }
.bidw .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.bidw .card-head h2, .bidw .card-head h3, .bidw .card-body h3 { margin: 0; color: var(--navy-2); }
.bidw .card-head h2 { font-size: 16px; font-weight: 800; }
.bidw .card-head h3, .bidw .card-body h3 { font-size: 14px; font-weight: 800; }
.bidw .card-head p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.bidw .card-body { padding: 20px; }
.bidw .guide { position: sticky; top: 92px; overflow: hidden; }
.bidw .guide-accent { height: 5px; background: linear-gradient(90deg, var(--orange), #ffab61); }
.bidw .guide-kicker { display: inline-flex; align-items: center; gap: 7px; color: var(--orange); font-size: 10px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.bidw .guide h2 { margin: 9px 0 8px; color: var(--navy-2); font-size: 17px; line-height: 1.3; font-weight: 800; }
.bidw .guide p { margin: 0; color: var(--muted); font-size: 12px; }
.bidw .guide-list { display: grid; gap: 12px; margin: 16px 0 0; padding: 0; list-style: none; }
.bidw .guide-list li { display: grid; grid-template-columns: 24px 1fr; gap: 9px; align-items: start; color: var(--ink); font-size: 12px; }
.bidw .guide-list b { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 7px; background: var(--blue-soft); color: var(--navy); font-size: 10px; }
.bidw .tip { margin-top: 16px; padding: 12px; border-radius: 11px; background: var(--orange-soft); color: #7e4a22; font-size: 11.5px; }
.bidw .tip.blue { background: var(--blue-soft); color: var(--navy-3); }
.bidw .tip.red { background: var(--red-soft); color: var(--red); }
.bidw .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.bidw .stat { padding: 14px 16px; background: var(--white); border: 1px solid var(--line); border-radius: 13px; box-shadow: 0 6px 18px rgba(23,53,81,.05); }
.bidw .stat-label { color: var(--muted); font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
.bidw .stat-value { display: block; margin-top: 5px; color: var(--navy-2); font-size: 22px; font-weight: 850; letter-spacing: -.02em; }
.bidw .stat-note { display: block; margin-top: 2px; color: var(--muted); font-size: 10.5px; }
.bidw .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.bidw .field-wide { grid-column: 1 / -1; }
.bidw label.lbl, .bidw .lbl { display: block; margin-bottom: 6px; color: var(--ink); font-size: 11.5px; font-weight: 750; }
.bidw .lbl small { color: var(--muted); font-weight: 600; margin-left: 4px; }
.bidw .lbl .req { color: var(--orange); }
.bidw .input { width: 100%; min-height: 40px; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: #fbfcfd; color: var(--ink); font-size: 13px; }
.bidw textarea.input { min-height: 84px; resize: vertical; }
.bidw .input:focus { outline: 3px solid rgba(31,82,126,.12); border-color: var(--navy-3); }
.bidw .input[readonly], .bidw .input:disabled { background: #f1f4f7; color: var(--muted); }
.bidw .field-note { margin: 5px 0 0; color: var(--muted); font-size: 11px; }
.bidw .field-error { margin: 5px 0 0; color: var(--red); font-size: 11px; font-weight: 700; }
.bidw .dropzone { display: grid; place-items: center; min-height: 160px; padding: 26px; border: 1.5px dashed #9fb4c7; border-radius: 14px; background: #f9fbfd; text-align: center; transition: background .15s ease, border-color .15s ease; }
.bidw .dropzone.over { background: var(--blue-soft); border-color: var(--navy-3); }
.bidw .upload-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; background: var(--blue-soft); color: var(--navy); font-size: 22px; font-weight: 850; margin: 0 auto; }
.bidw .dropzone h3 { margin: 12px 0 4px; font-size: 15px; color: var(--navy-2); }
.bidw .dropzone p { margin: 0; color: var(--muted); font-size: 11.5px; }
.bidw .file-list { display: grid; gap: 9px; margin-top: 14px; }
.bidw .file-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--white); }
.bidw .file-row.superseded { opacity: .65; }
.bidw .file-type { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: var(--green-soft); color: var(--green); font-size: 9px; font-weight: 850; }
.bidw .file-type.pdf { background: #fff0f0; color: var(--red); }
.bidw .file-type.img { background: var(--blue-soft); color: var(--navy-3); }
.bidw .file-type.doc { background: #eef1f4; color: var(--muted); }
.bidw .file-copy strong, .bidw .file-copy span { display: block; }
.bidw .file-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bidw .file-copy span { margin-top: 2px; color: var(--muted); font-size: 10.5px; }
.bidw .file-copy a { color: var(--navy-3); }
.bidw .file-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.bidw .pill { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .025em; }
.bidw .pill-green { background: var(--green-soft); color: var(--green); }
.bidw .pill-yellow { background: var(--amber-soft); color: var(--amber); }
.bidw .pill-blue { background: var(--blue-soft); color: var(--navy-3); }
.bidw .pill-red { background: var(--red-soft); color: var(--red); }
.bidw .pill-gray { background: #eef1f4; color: var(--muted); }
.bidw .summary-strip { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--line); }
.bidw .summary-strip > div { padding: 13px; background: var(--white); }
.bidw .summary-strip span { display: block; color: var(--muted); font-size: 9.5px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
.bidw .summary-strip strong { display: block; margin-top: 4px; color: var(--navy-2); font-size: 17px; }
.bidw .table-wrap { overflow-x: auto; }
.bidw table.tbl { width: 100%; border-collapse: collapse; min-width: 720px; }
.bidw table.tbl th { padding: 9px 10px; background: #f7f9fb; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 9.5px; font-weight: 800; letter-spacing: .055em; text-align: left; text-transform: uppercase; white-space: nowrap; }
.bidw table.tbl td { padding: 9px 8px; border-bottom: 1px solid #e8edf2; color: var(--ink); font-size: 12px; vertical-align: middle; }
.bidw table.tbl td.src { max-width: 168px; font-size: 10.5px; line-height: 1.35; }
.bidw table.tbl td.item { min-width: 210px; }
.bidw table.tbl td .file-actions { flex-wrap: nowrap; gap: 4px; }
.bidw table.tbl td .file-actions .btn-sm { padding: 3px 8px; min-height: 26px; }
.bidw table.tbl tr:last-child td { border-bottom: 0; }
.bidw tr.row-warning { background: #fffdf8; }
.bidw tr.row-question { background: #f8fbfe; }
.bidw tr.row-blocked { background: #fff7f7; }
.bidw tr.row-excluded { opacity: .55; }
.bidw tr.row-open { background: #f9fbfd; }
.bidw .item-name { display: block; font-weight: 750; }
.bidw .item-meta { display: block; margin-top: 3px; color: var(--muted); font-size: 10.5px; }
.bidw .money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bidw .qty { font-variant-numeric: tabular-nums; white-space: nowrap; }
.bidw .link-btn { border: 0; background: transparent; padding: 0; color: var(--navy-3); font-size: 11.5px; font-weight: 750; text-decoration: underline; }
.bidw .explain { border-top: 1px solid var(--line); background: #fbfcfd; }
.bidw .explain summary { padding: 12px 18px; color: var(--navy); font-size: 11.5px; font-weight: 750; cursor: pointer; }
.bidw .details-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; padding: 0 18px 16px; }
.bidw .detail-block { padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); min-width: 0; }
.bidw .detail-block span { display: block; color: var(--muted); font-size: 9.5px; font-weight: 700; text-transform: uppercase; }
.bidw .detail-block strong { display: block; margin-top: 4px; font-size: 11.5px; font-weight: 700; word-break: break-word; }
.bidw .detail-block small { display: block; margin-top: 3px; color: var(--muted); font-size: 10.5px; }
.bidw .qcard { overflow: hidden; border: 1px solid #bcd1e2; border-radius: 14px; background: var(--white); }
.bidw .qcard.answered { border-color: #cfe9d9; }
.bidw .qtop { display: flex; justify-content: space-between; gap: 14px; padding: 15px 18px; background: var(--blue-soft); border-bottom: 1px solid #cfe0ee; }
.bidw .qcard.answered .qtop { background: var(--green-soft); border-bottom-color: #cfe9d9; }
.bidw .qtop h3 { margin: 0; color: var(--navy-2); font-size: 14px; font-weight: 800; }
.bidw .qtop p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.bidw .qbody { padding: 18px; }
.bidw .found { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.bidw .found > div { padding: 12px; border: 1px solid var(--line); border-radius: 10px; }
.bidw .found span { display: block; color: var(--muted); font-size: 9.5px; font-weight: 750; text-transform: uppercase; }
.bidw .found strong { display: block; margin-top: 4px; font-size: 12px; font-weight: 700; }
.bidw .qtext { margin: 0 0 12px; color: var(--ink); font-size: 12.5px; font-weight: 700; }
.bidw .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.bidw .choice { padding: 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--white); color: var(--ink); text-align: left; font-size: 11px; font-weight: 650; }
.bidw .choice.selected { border-color: var(--green); background: var(--green-soft); color: #11613e; box-shadow: inset 0 0 0 1px var(--green); }
.bidw .choice strong { display: block; margin-bottom: 2px; font-size: 13px; }
.bidw .choice small { display: block; color: var(--muted); font-size: 10.5px; margin-top: 3px; }
.bidw .decision { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 11px 12px; border-radius: 10px; background: var(--green-soft); color: #176141; font-size: 11.5px; }
.bidw .decision.warn { background: var(--amber-soft); color: var(--amber); }
.bidw .decision.err { background: var(--red-soft); color: var(--red); }
.bidw .decision b { font-size: 14px; }
.bidw .calc { display: grid; grid-template-columns: minmax(0,1fr) 230px; gap: 20px; align-items: stretch; }
.bidw .calc-result { display: flex; flex-direction: column; justify-content: center; padding: 20px; border-radius: 14px; background: var(--navy); color: var(--white); }
.bidw .calc-result span { color: #bfd0df; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.bidw .calc-result strong { margin-top: 6px; font-size: 30px; letter-spacing: -.03em; font-weight: 800; }
.bidw .calc-result small { margin-top: 5px; color: #d5e1eb; font-size: 10.5px; }
.bidw .radio-row { display: flex; gap: 9px; margin-bottom: 14px; }
.bidw .mode-btn { flex: 1; padding: 10px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--white); color: var(--muted); font-size: 11px; font-weight: 750; }
.bidw .mode-btn.active { border-color: var(--navy); background: var(--blue-soft); color: var(--navy); }
.bidw .assumptions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; margin-top: 14px; }
.bidw .assumption { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcfd; font-size: 11px; }
.bidw .assumption .check { width: 17px; height: 17px; flex: 0 0 17px; display: grid; place-items: center; border-radius: 5px; background: var(--green-soft); color: var(--green); font-weight: 900; font-size: 10px; }
.bidw .toggle-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcfd; font-size: 12px; }
.bidw .toggle-row input { width: 16px; height: 16px; accent-color: var(--navy); }
.bidw .final-grid { display: grid; grid-template-columns: minmax(0,1fr) 310px; gap: 20px; align-items: start; }
.bidw .price-line { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.bidw .price-line:last-child { border-bottom: 0; }
.bidw .price-line span { color: var(--muted); font-size: 11.5px; }
.bidw .price-line strong { color: var(--navy-2); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.bidw .grand { margin-top: 4px; padding: 16px; border-radius: 12px; background: var(--navy); color: var(--white); }
.bidw .grand span { display: block; color: #bfd0df; font-size: 10px; text-transform: uppercase; }
.bidw .grand strong { display: block; margin-top: 4px; font-size: 28px; letter-spacing: -.025em; font-weight: 800; }
.bidw .checklist { display: grid; gap: 8px; }
.bidw .check-row { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 9px; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fbfcfd; }
.bidw .check-circle { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: var(--green-soft); color: var(--green); font-size: 10px; font-weight: 900; }
.bidw .check-row.blocking .check-circle { background: var(--red-soft); color: var(--red); }
.bidw .check-row.warning .check-circle { background: var(--amber-soft); color: var(--amber); }
.bidw .check-row.pending .check-circle { background: #eef1f4; color: var(--muted); }
.bidw .check-row strong { font-size: 11px; }
.bidw .check-row span { color: var(--green); font-size: 10px; font-weight: 800; text-align: right; }
.bidw .check-row.blocking span { color: var(--red); } .bidw .check-row.warning span { color: var(--amber); } .bidw .check-row.pending span { color: var(--muted); }
.bidw .footer-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.bidw .save-note { color: var(--muted); font-size: 11px; }
.bidw .finish-stack { display: grid; gap: 20px; }
.bidw .estimate-sheet { overflow: hidden; border: 1px solid #b9c8d5; border-radius: 14px; background: var(--white); box-shadow: var(--shadow); }
.bidw .estimate-band { height: 8px; background: var(--navy-3); border-bottom: 3px solid var(--orange); }
.bidw .estimate-sheet .estimate-page { padding: 0; min-height: 0; background: transparent; }
.bidw .estimate-sheet .estimate-card { width: auto; min-height: 0; margin: 0; box-shadow: none; }
.bidw .qbme-card { border: 1px solid #bcd1e2; }
.bidw .qbme-intro { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; }
.bidw .qbme-intro h2 { margin: 0; color: var(--navy-2); font-size: 16px; font-weight: 800; }
.bidw .qbme-intro p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.bidw .qbme-out { margin: 14px 0 0; padding: 16px; overflow: auto; border: 1px solid #c7d4df; border-radius: 10px; background: #0f2740; color: #f4f8fb; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; max-height: 420px; }
.bidw .qbme-sum { display: flex; justify-content: space-between; gap: 14px; margin-top: 12px; color: var(--muted); font-size: 11px; flex-wrap: wrap; }
.bidw .qbme-sum strong { color: var(--navy); font-size: 13px; }
.bidw .banner { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 12px; font-size: 12px; margin-bottom: 16px; }
.bidw .banner-info { background: var(--blue-soft); color: var(--navy-3); border: 1px solid #cfe0ee; }
.bidw .banner-warn { background: var(--amber-soft); color: var(--amber); border: 1px solid #f1e2c0; }
.bidw .banner-err { background: var(--red-soft); color: var(--red); border: 1px solid #f1c9c9; }
.bidw .banner-ok { background: var(--green-soft); color: #176141; border: 1px solid #cfe9d9; }
.bidw .banner button, .bidw .banner a { font-weight: 800; }
.bidw .kv { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; font-size: 12px; }
.bidw .kv span { color: var(--muted); }
.bidw .empty { padding: 26px; text-align: center; color: var(--muted); font-size: 12.5px; }
.bidw .modal-backdrop { position: fixed; inset: 0; background: rgba(14,47,80,.45); display: grid; place-items: center; z-index: 40; padding: 20px; }
.bidw .modal { width: min(720px, 100%); max-height: 90vh; overflow: auto; background: var(--white); border-radius: 16px; box-shadow: 0 30px 80px rgba(14,47,80,.35); }
.bidw .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 1120px) {
  .bidw-layout, .bidw .final-grid { grid-template-columns: 1fr; }
  .bidw .guide { position: static; }
  .bidw .stats { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (max-width: 820px) {
  .bidw-shell { display: block; }
  .bidw-side { position: static; width: 100%; height: auto; padding: 12px 12px 10px; }
  .bidw-brand, .bidw-chip, .bidw-side-foot { display: none; }
  .bidw-steps { display: flex; overflow-x: auto; gap: 7px; margin: 0; padding-bottom: 3px; }
  .bidw-step { min-width: max-content; grid-template-columns: 25px 1fr; padding: 8px 10px; background: rgba(255,255,255,.06); }
  .bidw-step-check, .bidw-step-dot { display: none; }
  .bidw-step-num { width: 24px; height: 24px; }
  .bidw-top { min-height: 58px; padding: 10px 14px; position: static; }
  .bidw-crumb { display: none; }
  .bidw-profile-copy { display: none; }
  .bidw-profile { border: 0; padding-left: 0; }
  .bidw-content { padding: 20px 14px 40px; }
  .bidw-heading { display: block; }
  .bidw-actions { margin-top: 12px; }
  .bidw .form-grid, .bidw .calc, .bidw .found, .bidw .kv { grid-template-columns: 1fr; }
  .bidw .summary-strip { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .bidw .choices { grid-template-columns: 1fr; }
  .bidw .details-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .bidw .stats, .bidw .assumptions { grid-template-columns: 1fr; }
  .bidw .card-head, .bidw .card-body { padding: 14px; }
  .bidw-actions .btn { flex: 1; }
  .bidw .footer-actions { align-items: stretch; flex-direction: column; }
}
@media print {
  .bidw-side, .bidw-top, .bidw-heading, .bidw .guide, .bidw .footer-actions, .bidw .qbme-card, .bidw .completion-card, .bidw .no-print { display: none !important; }
  .bidw-shell { display: block; }
  .bidw { background: #fff; }
  .bidw-content { max-width: none; padding: 0; }
  .bidw .card { box-shadow: none; }
  .bidw .estimate-sheet { box-shadow: none; border-radius: 0; border: 0; }
  .bidw .estimate-band { display: none; }
}
`;
}
