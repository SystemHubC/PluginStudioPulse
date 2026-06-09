import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import {
  Activity, Archive, Bot, CheckCircle2, Code2, File, Folder, FolderOpen, Hammer,
  Home, Loader2, PackageCheck, Play, Plus, RefreshCw, Search, Settings,
  ShieldCheck, Sparkles, Terminal, Trash2, Upload, Wrench, XCircle,
  SlidersHorizontal, Wand2, Save, Copy, Eye, KeyRound, ListChecks, Box, Info, AlertTriangle, User, LogIn, LogOut, ExternalLink, Crown
} from 'lucide-react';
import iconUrl from './assets/icon.png';
import './styles/app.css';

type FileNode = import('./vite-env').FileNode;
type Project = { id: string; root: string; actualRoot: string; name: string; manifest?: any };
type LogItem = { id: string; title: string; result: any; time: string };
type PulseProfile = {
  telegram_id_masked?: string | null;
  username?: string | null;
  photo_url?: string | null;
  tier?: string | null;
  subscription?: any;
  max_accounts?: number | null;
  beta_access?: boolean;
};
type AuthState = { loading: boolean; authenticated: boolean; profile: PulseProfile | null; error?: string };
type AuthorProfile = {
  public_id?: string | null;
  slug?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  website_url?: string | null;
  telegram_url?: string | null;
  status?: string | null;
  verified?: boolean;
  plugin_count?: number | null;
};
type StudioPrefs = { hideUnavailableTabs: boolean };
type ConfigField = {
  id: string;
  key: string;
  type: 'string' | 'boolean' | 'number';
  widget: 'text' | 'textarea' | 'password' | 'checkbox' | 'number' | 'select';
  title: string;
  placeholder: string;
  help: string;
  defaultValue: any;
  required: boolean;
  options: string;
};

const nav = [
  { id: 'home', label: 'Старт', icon: Home, authRequired: false },
  { id: 'editor', label: 'Редактор', icon: Code2, authRequired: false },
  { id: 'config', label: 'Конструктор', icon: SlidersHorizontal, authRequired: false },
  { id: 'doctor', label: 'Doctor / Test', icon: Wrench, authRequired: false },
  { id: 'publish', label: 'Публикация', icon: PackageCheck, authRequired: false },
  { id: 'stats', label: 'Статистика', icon: Activity, authRequired: true },
  { id: 'logs', label: 'Логи', icon: Terminal, authRequired: false },
  { id: 'settings', label: 'Настройки', icon: Settings, authRequired: false }
];

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }
function safeJson(value: any) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function uid() { return Math.random().toString(36).slice(2, 10); }
function studio() {
  const api = window.studio;
  if (!api) {
    throw new Error('Electron preload bridge window.studio не загружен. Запускай Studio через run-dev.bat / pnpm dev / собранный .exe, а не открывай http://localhost:5173 в обычном браузере. Если ошибка появилась внутри Electron, проверь preload-error в консоли и пересобери приложение.');
  }
  return api;
}
function lang(file?: string) {
  if (!file) return 'plaintext';
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.md')) return 'markdown';
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return 'yaml';
  if (file.endsWith('.toml')) return 'toml';
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript';
  if (file.endsWith('.js') || file.endsWith('.jsx')) return 'javascript';
  return 'plaintext';
}

function Splash({ done }: { done: () => void }) {
  useEffect(() => { const t = setTimeout(done, 1200); return () => clearTimeout(t); }, [done]);
  return <div className="splash">
    <div className="splash-card">
      <img src={iconUrl} className="splash-logo" />
      <h1>Pulse Plugin Studio</h1>
      <p>Загрузка проектов, SDK-инструментов и редактора</p>
      <div className="pulse-loader"><span /></div>
    </div>
  </div>;
}

function WindowTitlebar() {
  // The real minimize/maximize/close buttons now come from Electron's native
  // title bar overlay. This small branded strip is only a draggable themed area.
  return <div className="window-titlebar window-drag">
    <div className="title-left"><img src={iconUrl} /><span>Pulse Plugin Studio</span><b>SDK</b></div>
    <div className="title-center" />
  </div>;
}

function Button({ children, onClick, variant = 'secondary', disabled, icon }: any) {
  return <button className={cx('btn', `btn-${variant}`)} onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

function FileTree({ nodes, active, onOpen, onCreate, onRename, onDelete }: any) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const render = (node: FileNode, depth = 0) => {
    const isDir = node.type === 'directory';
    const expanded = open[node.path] ?? true;
    return <div key={node.path || node.name}>
      <div className={cx('tree-row', active === node.path && 'active')} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => isDir ? setOpen(o => ({...o, [node.path]: !expanded})) : onOpen(node.path)}>
        <span className="tree-icon">{isDir ? (expanded ? <FolderOpen size={15}/> : <Folder size={15}/>) : <File size={15}/>}</span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          {isDir && <button title="Создать файл" onClick={() => onCreate(node.path, 'file')}>+</button>}
          {isDir && <button title="Создать папку" onClick={() => onCreate(node.path, 'directory')}>∕</button>}
          <button title="Переименовать" onClick={() => onRename(node.path)}>↵</button>
          <button title="Удалить" onClick={() => onDelete(node.path)}><Trash2 size={12}/></button>
        </span>
      </div>
      {isDir && expanded && node.children?.map(child => render(child, depth + 1))}
    </div>;
  };
  return <div className="tree">{nodes.map((n: FileNode) => render(n))}</div>;
}

function LogCard({ item }: { item: LogItem }) {
  const ok = item.result?.success;
  const command = item.result?.command || item.result?.setup?.command;
  const stdout = item.result?.stdout || item.result?.setup?.stdout;
  const stderr = item.result?.stderr || item.result?.setup?.stderr;
  const wheel = item.result?.wheel || item.result?.setup?.wheel;
  return <div className={cx('log-card', ok ? 'ok' : 'bad')}>
    <div className="log-head">
      {ok ? <CheckCircle2 size={17}/> : <XCircle size={17}/>}<b>{item.title}</b><span>{item.time}</span>
    </div>
    {item.result?.hint && <div className={cx('hint', ok && 'hint-ok')}>{item.result.hint}</div>}
    {command && <div className="log-meta"><b>Команда</b><code>{command}</code></div>}
    {wheel && <div className="log-meta"><b>SDK wheel</b><code>{wheel}</code></div>}
    {(stdout || stderr) && <div className="log-streams">
      {stdout && <details open={!!ok}><summary>stdout</summary><pre>{stdout}</pre></details>}
      {stderr && <details open={!ok}><summary>stderr</summary><pre>{stderr}</pre></details>}
    </div>}
    <details className="raw-json"><summary>Полный JSON результата</summary><pre>{safeJson(item.result)}</pre></details>
  </div>;
}

function SdkChecklist({ projectId, root, onEnsure, onRun }: any) {
  return <div className="sdk-checklist card">
    <div className="sdk-checklist-head"><Info size={18}/><div><h3>Готовность SDK</h3><p>{projectId ? 'Рекомендуемый порядок перед выкладкой' : 'Создай или импортируй проект, затем пройди проверки'}</p></div></div>
    <div className="sdk-steps">
      <button disabled={!projectId} onClick={onEnsure}><span>1</span><b>Установить SDK</b><small>.venv + wheel + pulse-plugin</small></button>
      <button disabled={!projectId} onClick={() => onRun('check')}><span>2</span><b>Check</b><small>manifest и fixtures без запуска кода</small></button>
      <button disabled={!projectId} onClick={() => onRun('test')}><span>3</span><b>Test</b><small>локальный запуск app.py на fixtures</small></button>
      <button disabled={!projectId} onClick={() => onRun('doctor')}><span>4</span><b>Doctor</b><small>полный preflight перед pack/upload</small></button>
      <button disabled={!projectId} onClick={() => onRun('pack')}><span>5</span><b>Pack</b><small>сборка .fppkg в dist</small></button>
    </div>
    <div className="sdk-note"><AlertTriangle size={15}/>Если wheel лежит внутри <code>app.asar</code>, v10 копирует его в реальную папку <code>userData/sdk-cache</code> перед установкой.</div>
    {root && <div className="sdk-path">{root}</div>}
  </div>;
}

function readFieldsFromManifest(manifest: any): ConfigField[] {
  const schema = manifest?.config_schema || { properties: {} };
  const ui = manifest?.ui_schema || {};
  const required = new Set(schema.required || []);
  const props = schema.properties || {};
  return Object.entries<any>(props).map(([key, prop]) => {
    const uiField = ui[key] || {};
    const widget = uiField['ui:widget'] || (prop.type === 'boolean' ? 'checkbox' : prop.type === 'number' ? 'number' : prop.enum ? 'select' : 'text');
    return {
      id: uid(),
      key,
      type: prop.type || (widget === 'checkbox' ? 'boolean' : widget === 'number' ? 'number' : 'string'),
      widget,
      title: prop.title || key,
      placeholder: uiField['ui:placeholder'] || uiField.placeholder || '',
      help: uiField['ui:help'] || '',
      defaultValue: prop.default ?? '',
      required: required.has(key),
      options: Array.isArray(prop.enum) ? prop.enum.join('\n') : ''
    } as ConfigField;
  });
}

function buildManifestWithFields(manifest: any, fields: ConfigField[]) {
  const properties: Record<string, any> = {};
  const ui_schema: Record<string, any> = {};
  const required: string[] = [];
  for (const f of fields) {
    const key = f.key.trim().replace(/[^a-zA-Z0-9_]+/g, '_');
    if (!key) continue;
    const type = f.widget === 'checkbox' ? 'boolean' : f.widget === 'number' ? 'number' : f.type;
    const prop: any = { type, title: f.title || key };
    if (f.defaultValue !== '') {
      prop.default = type === 'boolean' ? !!f.defaultValue : type === 'number' ? Number(f.defaultValue) || 0 : f.defaultValue;
    }
    if (f.widget === 'select') prop.enum = f.options.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    properties[key] = prop;
    const ui: any = { 'ui:widget': f.widget };
    if (f.placeholder) ui['ui:placeholder'] = f.placeholder;
    if (f.help) ui['ui:help'] = f.help;
    if (f.widget === 'textarea') ui['ui:rows'] = 4;
    ui_schema[key] = ui;
    if (f.required) required.push(key);
  }
  return { ...manifest, config_schema: { type: 'object', properties, required }, ui_schema };
}

function ConfigPreview({ fields }: { fields: ConfigField[] }) {
  return <div className="plugin-preview">
    <div className="preview-title"><Sparkles size={18}/><div><b>Предпросмотр настроек</b><span>Широкий live-preview будущей страницы настроек</span></div></div>
    {fields.length === 0 && <div className="empty-mini">Добавь первое поле слева</div>}
    {fields.map(f => <div className="preview-field" key={f.id}>
      <label>{f.title || f.key}{f.required && <em>*</em>}</label>
      {f.widget === 'textarea' && <textarea placeholder={f.placeholder} defaultValue={String(f.defaultValue || '')}/>} 
      {f.widget === 'checkbox' && <div className="switch-row"><span>{f.help || 'Включить параметр'}</span><i className="switch on" /></div>}
      {f.widget === 'select' && <select defaultValue={String(f.defaultValue || '')}>{f.options.split(/\r?\n/).filter(Boolean).map(o => <option key={o}>{o}</option>)}</select>}
      {['text','password','number'].includes(f.widget) && <input type={f.widget === 'password' ? 'password' : f.widget === 'number' ? 'number' : 'text'} placeholder={f.placeholder} defaultValue={String(f.defaultValue || '')}/>} 
      {f.help && f.widget !== 'checkbox' && <small>{f.help}</small>}
    </div>)}
  </div>;
}

function ConfigBuilder({ projectId, addLog }: { projectId: string; addLog: any }) {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [manifest, setManifest] = useState<any>({});
  const [selected, setSelected] = useState('');
  const active = fields.find(f => f.id === selected) || fields[0];

  async function load() {
    if (!projectId) return;
    const m = await studio().getManifest(projectId);
    setManifest(m || {});
    const next = readFieldsFromManifest(m || {});
    setFields(next);
    setSelected(next[0]?.id || '');
  }
  useEffect(() => { load(); }, [projectId]);

  function addField(widget: ConfigField['widget']) {
    const type = widget === 'checkbox' ? 'boolean' : widget === 'number' ? 'number' : 'string';
    const field: ConfigField = {
      id: uid(), key: `field_${fields.length + 1}`, type, widget,
      title: widget === 'checkbox' ? 'Переключатель' : 'Новое поле',
      placeholder: '', help: '', defaultValue: widget === 'checkbox' ? true : '', required: false,
      options: widget === 'select' ? 'safe\nfast' : ''
    };
    setFields([...fields, field]); setSelected(field.id);
  }
  function patch(id: string, changes: Partial<ConfigField>) { setFields(rows => rows.map(f => f.id === id ? { ...f, ...changes } : f)); }
  async function save() {
    const next = buildManifestWithFields(manifest, fields);
    await studio().saveManifest(projectId, next);
    await addLog('save config schema', Promise.resolve({ success: true, fields: fields.length, file: 'funpay-pulse.plugin.json' }));
  }

  return <section className="builder-layout">
    <div className="builder-left card">
      <div className="pane-title"><b>Поля настроек</b><Button variant="primary" onClick={save} icon={<Save size={15}/>}>Сохранить</Button></div>
      <div className="add-grid">
        <button onClick={() => addField('text')}>Text</button>
        <button onClick={() => addField('textarea')}>Textarea</button>
        <button onClick={() => addField('password')}>Password</button>
        <button onClick={() => addField('checkbox')}>Switch</button>
        <button onClick={() => addField('number')}>Number</button>
        <button onClick={() => addField('select')}>Select</button>
      </div>
      <div className="field-list">
        {fields.map(f => <button key={f.id} className={cx(selected === f.id && 'active')} onClick={() => setSelected(f.id)}><span>{f.title || f.key}</span><small>{f.key} · {f.widget}</small></button>)}
      </div>
    </div>
    <div className="builder-center card">
      <h3>Редактирование поля</h3>
      {!active ? <div className="empty-mini">Выбери или создай поле</div> : <div className="field-form">
        <label>Ключ<input value={active.key} onChange={e => patch(active.id, { key: e.target.value })}/></label>
        <label>Название<input value={active.title} onChange={e => patch(active.id, { title: e.target.value })}/></label>
        <label>Виджет<select value={active.widget} onChange={e => patch(active.id, { widget: e.target.value as any })}><option value="text">text</option><option value="textarea">textarea</option><option value="password">password</option><option value="checkbox">checkbox</option><option value="number">number</option><option value="select">select</option></select></label>
        <label>Placeholder<input value={active.placeholder} onChange={e => patch(active.id, { placeholder: e.target.value })}/></label>
        <label>Help text<input value={active.help} onChange={e => patch(active.id, { help: e.target.value })}/></label>
        {active.widget !== 'checkbox' && <label>Значение по умолчанию<input value={String(active.defaultValue)} onChange={e => patch(active.id, { defaultValue: e.target.value })}/></label>}
        {active.widget === 'select' && <label>Опции, каждая с новой строки<textarea value={active.options} onChange={e => patch(active.id, { options: e.target.value })}/></label>}
        <label className="check-line"><input type="checkbox" checked={active.required} onChange={e => patch(active.id, { required: e.target.checked })}/>Обязательное поле</label>
        <div className="row"><Button onClick={() => { setFields(rows => rows.filter(f => f.id !== active.id)); setSelected(''); }} icon={<Trash2 size={15}/>}>Удалить поле</Button></div>
      </div>}
    </div>
    <div className="builder-preview card"><ConfigPreview fields={fields}/></div>
  </section>;
}

function TerminalLite({ projectId, addLog }: any) {
  const [cmd, setCmd] = useState('pulse-plugin doctor . --allow-localhost --require-fixtures');
  return <div className="terminal-lite"><h4>Terminal Lite</h4><p>Разрешены только команды pulse-plugin и python внутри проекта.</p><div className="cmdline"><input value={cmd} onChange={e => setCmd(e.target.value)} /><Button variant="primary" onClick={() => projectId && addLog(`custom: ${cmd}`, studio().runCommand(projectId, 'custom', { command: cmd }))}><Play size={15}/>Запустить</Button></div></div>;
}

function Publish({ projectId, addLog }: any) {
  const [token, setToken] = useState('');
  const [product, setProduct] = useState('');
  const [publicReview, setPublicReview] = useState(true);
  const [trusted, setTrusted] = useState(false);
  const [api, setApi] = useState('https://funpaypulse.com');
  const [pkgs, setPkgs] = useState<any[]>([]);
  async function refreshPkgs() { if (projectId) setPkgs(await studio().packageInfo(projectId)); }
  useEffect(() => { refreshPkgs(); }, [projectId]);

  async function publishNew() {
    if (!projectId) return;
    if (!token.trim()) return alert('Вставь developer token fppd_...');
    if (!confirm('Опубликовать новый продукт на review? Пакет будет загружен в Pulse, но не станет публичным без проверки.')) return;
    await addLog('publish: новый продукт на review', studio().publishPackage(projectId, { token, publicReview, trusted, api }));
  }
  async function publishUpdate() {
    if (!projectId) return;
    if (!token.trim()) return alert('Вставь developer token fppd_...');
    if (!product.trim()) return alert('Введи Product ID существующего продукта, например plp_...');
    if (!confirm(`Обновить существующий продукт ${product.trim()} и отправить новую версию на review?`)) return;
    await addLog('publish: обновить существующий продукт', studio().publishPackage(projectId, { token, productId: product.trim(), publicReview, trusted, api }));
  }

  return <section className="publish-layout">
    <div className="stack card publish-main">
      <h3>Публикация</h3>
      <p>Сначала запусти Doctor и Pack. Upload отправляет пакет на review, а не публикует его мгновенно.</p>
      <div className="form-grid">
        <label>Developer token<input value={token} onChange={e => setToken(e.target.value)} placeholder="fppd_..." type="password" /></label>
        <label>API<input value={api} onChange={e => setApi(e.target.value)} placeholder="https://funpaypulse.com" /></label>
        <label>Product ID существующего продукта<input value={product} onChange={e => setProduct(e.target.value)} placeholder="plp_..." /></label>
        <span />
        <label className="check"><input type="checkbox" checked={publicReview} onChange={e => setPublicReview(e.target.checked)} />Отправить на public-review</label>
        <label className="check"><input type="checkbox" checked={trusted} onChange={e => setTrusted(e.target.checked)} />trusted</label>
      </div>
      <div className="publish-actions">
        <Button onClick={() => projectId && addLog('pack', studio().runCommand(projectId, 'pack', { trusted })).then(refreshPkgs)} icon={<PackageCheck size={15}/>}>Собрать .fppkg</Button>
        <Button onClick={refreshPkgs} icon={<RefreshCw size={15}/>}>Обновить пакеты</Button>
        <Button variant="primary" onClick={publishNew} icon={<Upload size={15}/>}>Опубликовать на review</Button>
        <Button variant="primary" onClick={publishUpdate} icon={<RefreshCw size={15}/>}>Обновить текущий плагин</Button>
      </div>
      <div className="hint">Token пишется во временный файл и удаляется после команды. В проект он не сохраняется.</div>
    </div>
    <div className="stack card publish-side">
      <h3>Package Inspector</h3>
      {pkgs.length === 0 && <p>Пока нет .fppkg в dist. Нажми Pack.</p>}
      {pkgs.map(p => <div className="pkg" key={p.path}><Box size={17}/><div><b>{p.name}</b><span>{p.sha256}</span></div><button onClick={() => navigator.clipboard.writeText(p.sha256)}>SHA</button></div>)}
    </div>
  </section>;
}


function profileAvatar(profile: PulseProfile | null) {
  if (!profile) return '';
  if (profile.photo_url) return profile.photo_url;
  if (profile.username) return `https://funpaypulse.com/telegram-avatar/${encodeURIComponent(profile.username)}`;
  return '';
}

function tierLabel(tier?: string | null) {
  if (!tier) return 'standard';
  return tier === 'standard' ? 'standard' : tier;
}

function AvatarView({ src, name, size = 30, big = false }: { src?: string | null; name?: string | null; size?: number; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const initial = String(name || 'P').trim().replace(/^@/, '').slice(0, 1).toUpperCase() || 'P';
  const cls = cx('avatar-view', big && 'big');
  if (src && !failed) {
    return <img className={cls} src={src} alt={name || 'avatar'} onError={() => setFailed(true)} style={{ width: size, height: size }} />;
  }
  return <span className={cls} style={{ width: size, height: size }}><b>{initial}</b></span>;
}

function ProfileButton({ auth, onLogin, onLogout, onOpenAuthor, addLog }: { auth: AuthState; onLogin: () => void; onLogout: () => Promise<void>; onOpenAuthor: () => Promise<void>; addLog: any }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const profile = auth.profile;
  const avatar = profileAvatar(profile);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!auth.authenticated || !profile) {
    return <div className="profile-wrap" ref={wrapRef}><button className="profile-chip guest" onClick={onLogin}><LogIn size={16}/><div><b>Войти</b><span>гость</span></div></button></div>;
  }
  return <div className="profile-wrap" ref={wrapRef}>
    <button className="profile-chip" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <AvatarView src={avatar} name={profile.username} size={30}/>
      <div className="profile-chip-text"><b>{profile.username || 'Pulse account'}</b><span><Crown size={12}/>{tierLabel(profile.tier)}</span></div>
    </button>
    {open && <div className="profile-menu card">
      <div className="profile-menu-head">
        <AvatarView src={avatar} name={profile.username} size={42} big/>
        <div className="profile-menu-head-text"><b>{profile.username || 'Pulse account'}</b><span>tier: {tierLabel(profile.tier)}</span></div>
      </div>
      {profile.subscription && <div className="profile-sub">
        <span>Подписка</span><b>{profile.subscription.active ? 'активна' : 'не активна'}</b>
        {profile.subscription.days_remaining != null && <em>{profile.subscription.days_remaining} дн.</em>}
      </div>}
      <div className="profile-menu-actions">
        <button className="profile-menu-item" onClick={async () => { setOpen(false); await onOpenAuthor(); }}>
          <ExternalLink size={16}/>
          <div><b>Профиль разработчика</b><span>Открыть страницу автора на FunPay Pulse</span></div>
        </button>
        <button className="profile-menu-item danger" onClick={async () => { setOpen(false); await onLogout(); }}>
          <LogOut size={16}/>
          <div><b>Выйти из аккаунта</b><span>Завершить текущую сессию в Studio</span></div>
        </button>
      </div>
    </div>}
  </div>;
}

function FirstLoginPrompt({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return <div className="modal-backdrop">
    <div className="first-login-modal card">
      <div className="modal-icon"><Bot size={28}/></div>
      <h2>Войти в FunPay Pulse?</h2>
      <p>Можно подключить аккаунт, чтобы Studio показывала профиль, tier и быстро открывала страницу разработчика. Можно пропустить и работать гостем.</p>
      <div className="modal-actions"><Button variant="primary" onClick={onAccept} icon={<LogIn size={16}/>}>Войти</Button><Button onClick={onDecline}>Остаться гостем</Button></div>
    </div>
  </div>;
}

function TelegramLoginModal({ open, authCode, timeLeft, busy, error, onStart, onClose, onOpenBot }: any) {
  if (!open) return null;
  const code = authCode?.code || '••••••';
  const bot = authCode?.bot_username || 'pulse_funpaybot';
  return <div className="modal-backdrop">
    <div className="telegram-modal card">
      <button className="modal-x" onClick={onClose}>×</button>
      <div className="telegram-logo"><Bot size={34}/></div>
      <h2>Войти через Telegram</h2>
      <p>Авторизуйся через Telegram, чтобы управлять подпиской и профилем.</p>
      {!authCode && <div className="modal-actions single"><Button variant="primary" onClick={onStart} disabled={busy} icon={busy ? <Loader2 className="spin" size={16}/> : <LogIn size={16}/>}>{busy ? 'Получаю код...' : 'Получить код'}</Button></div>}
      {authCode && <>
        <span className="code-label">Отправьте этот код боту в Telegram:</span>
        <div className="telegram-code">{String(code).split('').map((c: string, i: number) => <span key={i}>{c}</span>)}</div>
        <div className="expires">Истекает через {Math.max(0, timeLeft)} сек.</div>
        <button className="telegram-open" onClick={() => onOpenBot(code, bot)}><Bot size={18}/>Открыть @{bot}</button>
        <div className="waiting"><span/>Ожидаем подтверждение...</div>
      </>}
      {error && <div className="auth-error">{error}</div>}
      <button className="text-cancel" onClick={onClose}>Отмена</button>
    </div>
  </div>;
}

function rub(value: any) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

function fmtDate(value: any) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ru-RU'); } catch { return String(value); }
}

function arr(data: any): any[] {
  return Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
}

function statusClass(status?: string | null) {
  const s = String(status || '').toLowerCase();
  if (['active','posted','approved','trusted','public','published','running'].includes(s)) return 'ok';
  if (['pending','public_pending','private_unreviewed','idle','stopped'].includes(s)) return 'warn';
  if (['revoked','expired','failed','dead','rejected'].includes(s)) return 'bad';
  return '';
}

function GateCard({ onLogin }: { onLogin: () => void }) {
  return <section className="gate-card card">
    <div className="gate-icon"><User size={30}/></div>
    <h2>Нужен вход в FunPay Pulse</h2>
    <p>Эта вкладка использует личные API: профиль автора, установки, доходы, продукты и developer-токены. В гостевом режиме эти данные недоступны.</p>
    <Button variant="primary" onClick={onLogin} icon={<LogIn size={16}/>}>Войти через Telegram</Button>
  </section>;
}


function MarketplaceMetadataEditor({ open, content, onApply, onClose }: { open: boolean; content: string; onApply: (next: string) => void; onClose: () => void }) {
  const [form, setForm] = useState<any>({
    pricing_type: 'subscription',
    price_rub: 350,
    access_duration_days: 30,
    trial_days: 0,
    category: 'automation',
    summary: '',
    support_telegram: '',
    support_url: '',
    privacy_url: '',
    refund_policy: ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    try {
      const json = content?.trim() ? JSON.parse(content) : {};
      setForm({
        pricing_type: json.pricing_type || 'subscription',
        price_rub: json.price_rub ?? 0,
        access_duration_days: json.access_duration_days ?? 30,
        trial_days: json.trial_days ?? 0,
        category: json.category || 'automation',
        summary: json.summary || '',
        support_telegram: json.support?.telegram || '',
        support_url: json.support_url || '',
        privacy_url: json.privacy_url || '',
        refund_policy: json.refund_policy || ''
      });
      setError('');
    } catch (e: any) {
      setError('JSON сейчас не парсится. Редактор открылся с шаблоном, но старый текст не потерян, пока не нажать “Применить”.');
    }
  }, [open]);

  if (!open) return null;

  function buildJson() {
    const obj = {
      pricing_type: form.pricing_type,
      price_rub: Number(form.price_rub || 0),
      access_duration_days: form.pricing_type === 'subscription' ? Number(form.access_duration_days || 30) : null,
      trial_days: Number(form.trial_days || 0),
      category: form.category || 'automation',
      summary: form.summary || '',
      support: { telegram: form.support_telegram || '' },
      support_url: form.support_url || '',
      privacy_url: form.privacy_url || '',
      refund_policy: form.refund_policy || ''
    };
    return JSON.stringify(obj, null, 2);
  }

  return <div className="modal-backdrop">
    <div className="marketplace-editor-modal card">
      <button className="modal-x" onClick={onClose}>×</button>
      <div className="section-head"><div><h2>Marketplace metadata editor</h2><p>Визуальное редактирование funpay-pulse.marketplace.json перед pack/upload.</p></div></div>
      {error && <div className="auth-error">{error}</div>}
      <div className="marketplace-editor-grid">
        <div className="form-grid wide">
          <label><span>Тип оплаты</span><select value={form.pricing_type} onChange={e => setForm({...form, pricing_type: e.target.value})}><option value="free">free</option><option value="one_time">one_time</option><option value="subscription">subscription</option><option value="trial">trial</option></select></label>
          <label><span>Цена, ₽</span><input type="number" value={form.price_rub} onChange={e => setForm({...form, price_rub: e.target.value})}/></label>
          <label><span>Срок доступа, дней</span><input type="number" value={form.access_duration_days} onChange={e => setForm({...form, access_duration_days: e.target.value})}/></label>
          <label><span>Trial, дней</span><input type="number" value={form.trial_days} onChange={e => setForm({...form, trial_days: e.target.value})}/></label>
          <label><span>Категория</span><input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="automation"/></label>
          <label><span>Telegram поддержки</span><input value={form.support_telegram} onChange={e => setForm({...form, support_telegram: e.target.value})} placeholder="@developer"/></label>
          <label className="full"><span>Краткое описание</span><textarea rows={4} value={form.summary} onChange={e => setForm({...form, summary: e.target.value})}/></label>
          <label><span>support_url</span><input value={form.support_url} onChange={e => setForm({...form, support_url: e.target.value})} placeholder="https://..."/></label>
          <label><span>privacy_url</span><input value={form.privacy_url} onChange={e => setForm({...form, privacy_url: e.target.value})} placeholder="https://..."/></label>
          <label className="full"><span>refund_policy</span><textarea rows={3} value={form.refund_policy} onChange={e => setForm({...form, refund_policy: e.target.value})}/></label>
        </div>
        <div className="marketplace-card-preview card">
          <span className="badge ok">{form.pricing_type}</span>
          <h3>{form.summary || 'Описание плагина для маркетплейса'}</h3>
          <b>{form.pricing_type === 'free' ? 'Бесплатно' : rub(form.price_rub)}</b>
          <p>{form.category} • {form.support_telegram || 'support Telegram'} • {form.access_duration_days || 0} дн.</p>
          <small>{form.refund_policy || 'Условия возврата будут показаны на ревью.'}</small>
        </div>
      </div>
      <div className="modal-actions">
        <Button variant="primary" onClick={() => { onApply(buildJson()); onClose(); }} icon={<Save size={16}/>}>Применить в JSON</Button>
        <Button onClick={onClose}>Отмена</Button>
      </div>
    </div>
  </div>;
}

function TokenShownModal({ tokenData, onClose }: { tokenData: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!tokenData) return null;
  const token = tokenData.token || '';
  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, 60000);
  }
  return <div className="modal-backdrop">
    <div className="token-modal card">
      <button className="modal-x" onClick={onClose}>×</button>
      <div className="modal-icon"><KeyRound size={28}/></div>
      <h2>Developer token создан</h2>
      <p>Скопируй токен сейчас. Он показывается один раз и не сохраняется в Studio.</p>
      <div className="token-box">{token || tokenData.token_redacted || 'fppd_...'}</div>
      {copied && <div className="inline-message">Токен скопирован. Ради безопасности буфер обмена очистится через 60 секунд.</div>}
      <div className="modal-actions">
        <Button variant="primary" onClick={copyToken} icon={<Copy size={16}/>}>Скопировать</Button>
        <Button onClick={onClose}>Закрыть</Button>
      </div>
    </div>
  </div>;
}

function DeveloperTokensPanel({ tokens, onRefresh }: { tokens: any[]; onRefresh: () => void }) {
  const [busy, setBusy] = useState('');
  const [shown, setShown] = useState<any>(null);

  async function createToken() {
    const name = prompt('Название developer token', 'SDK CLI') || 'SDK CLI';
    setBusy('create-token');
    try {
      const result = await studio().developerTokenCreate({ name });
      if (!result?.success) throw new Error(result?.error || 'Не удалось создать token.');
      setShown(result);
      await onRefresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }

  async function revokeToken(token: any) {
    if (!confirm(`Отозвать developer token “${token.name || token.public_id}”? Это действие нельзя отменить.`)) return;
    setBusy(token.public_id);
    try {
      const result = await studio().developerTokenRevoke(token.public_id);
      if (!result?.success) throw new Error(result?.error || 'Не удалось отозвать token.');
      await onRefresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }

  return <div className="card stat-panel">
    <div className="section-head"><div><h3>Developer-токены</h3><p>Создание и отзыв SDK publish tokens.</p></div><Button onClick={createToken} disabled={!!busy} icon={<Plus size={15}/>}>Создать token</Button></div>
    <div className="table-lite">
      {tokens.slice(0,10).map(t => <div className="table-row token-row" key={t.public_id}>
        <div><b>{t.name}</b><span>{t.token_redacted} • last: {fmtDate(t.last_used_at)} • exp: {fmtDate(t.expires_at)}</span></div>
        <div className="token-actions"><em className={cx('badge', statusClass(t.status))}>{t.status}</em>{t.status === 'active' && <button onClick={() => revokeToken(t)} disabled={busy === t.public_id}>{busy === t.public_id ? '...' : 'Отозвать'}</button>}</div>
      </div>)}
      {!tokens.length && <p>Токенов пока нет.</p>}
    </div>
    <TokenShownModal tokenData={shown} onClose={() => setShown(null)}/>
  </div>;
}

function ProductDashboard({ products, installs, ledgerItems }: { products: any[]; installs: any[]; ledgerItems: any[] }) {
  const [productId, setProductId] = useState('');
  const selected = products.find(p => p.public_id === productId) || products[0];
  useEffect(() => { if (!productId && products[0]) setProductId(products[0].public_id); }, [products.length]);
  if (!selected) return <div className="card stat-panel"><h3>Dashboard плагина</h3><p>Нет продуктов для анализа.</p></div>;

  const productInstalls = installs.filter(i => i.product_public_id === selected.public_id || i.plugin_id === selected.plugin_id);
  const productLedger = ledgerItems.filter(e => e.product?.public_id === selected.public_id || e.product?.plugin_id === selected.plugin_id);
  const gross = productLedger.filter(e => e.entry_type === 'sale').reduce((s,e) => s + Number(e.amount_rub || 0), 0);
  const fees = Math.abs(productLedger.filter(e => e.entry_type === 'platform_fee').reduce((s,e) => s + Number(e.amount_rub || 0), 0));
  const active = productInstalls.filter(i => i.status === 'active').length;
  const runtimeErrors = productInstalls.reduce((s,i) => s + Number(i.runtime?.failed_actions || 0) + Number(i.runtime?.dead_actions || 0), 0);

  return <div className="card stat-panel product-dashboard">
    <div className="section-head"><div><h3>Dashboard по плагину</h3><p>Быстрый разбор конкретного продукта.</p></div><select value={selected.public_id} onChange={e => setProductId(e.target.value)}>{products.map(p => <option key={p.public_id} value={p.public_id}>{p.name || p.plugin_id}</option>)}</select></div>
    <div className="plugin-overview">
      <div><span>Версия</span><b>{selected.current_version?.version || '—'}</b></div>
      <div><span>Цена</span><b>{rub(selected.price_rub)}</b></div>
      <div><span>Установки</span><b>{active}/{productInstalls.length}</b></div>
      <div><span>Доход</span><b>{rub(gross - fees)}</b></div>
      <div><span>Review</span><b>{selected.review_state || '—'}</b></div>
      <div><span>Trust</span><b>{selected.trust_state || '—'}</b></div>
    </div>
    <div className="hint-box"><Info size={16}/>Runtime errors: {runtimeErrors}. Package SHA: {selected.current_version?.package_sha256 || '—'}</div>
  </div>;
}

function SecurityScanCard({ projectId }: { projectId: string }) {
  const [scan, setScan] = useState<any>(null);
  const [guard, setGuard] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!projectId) return;
    setBusy(true);
    try {
      const [security, packageResult] = await Promise.all([
        studio().securityScan(projectId),
        studio().packageGuard(projectId)
      ]);
      setScan(security);
      setGuard(packageResult);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { if (projectId) void run(); }, [projectId]);
  return <div className="card security-card">
    <div className="section-head"><div><h3>Security & review package guard</h3><p>Проверка токенов, .env, private keys и защита review-пакета от лишних файлов.</p></div><Button onClick={run} disabled={!projectId || busy} icon={busy ? <Loader2 className="spin" size={15}/> : <ShieldCheck size={15}/>}>Сканировать</Button></div>
    {!projectId && <p>Выбери проект для проверки безопасности и состава review-пакета.</p>}
    {guard && <div className="package-guard-box">
      <div className="metric-line"><span>Clean review staging</span><b>{guard.clean ? 'включён' : 'выключен'}</b></div>
      <div className="metric-line"><span>Файлов попадёт в staging</span><b>{guard.included_count}</b></div>
      <div className="metric-line"><span>Лишних файлов исключено</span><b>{guard.excluded_count}</b></div>
      {guard.missing?.length ? <div className="auth-error">Не хватает обязательных файлов: {guard.missing.join(', ')}</div> : <div className="inline-message">{guard.hint}</div>}
      {guard.excluded?.length ? <details className="guard-details"><summary>Показать исключённые файлы/папки</summary>{guard.excluded.slice(0,30).map((x: any, i: number) => <div key={i} className="guard-row"><b>{x.path}</b><span>{x.reason}</span></div>)}</details> : null}
    </div>}
    {scan && <div className="security-summary">
      <div className={cx('security-pill', scan.counts.critical && 'bad')}><b>{scan.counts.critical}</b><span>critical</span></div>
      <div className={cx('security-pill', scan.counts.warning && 'warn')}><b>{scan.counts.warning}</b><span>warnings</span></div>
      <div className="security-pill"><b>{scan.counts.info}</b><span>info</span></div>
    </div>}
    {scan?.warnings?.length ? <div className="security-list">{scan.warnings.slice(0,12).map((w: any, idx: number) => <div className={cx('security-row', w.level)} key={idx}><b>{w.title}</b><span>{w.file}</span><p>{w.detail}</p></div>)}</div> : scan && <div className="inline-message">{scan.hint}</div>}
  </div>;
}

function AuthorProfileSettings({ auth, onLogin, onOpenAuthor, addLog }: { auth: AuthState; onLogin: () => void; onOpenAuthor: () => Promise<void>; addLog: any }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [previewProducts, setPreviewProducts] = useState<any[]>([]);
  const [profileDirty, setProfileDirty] = useState(false);
  const loadedOnceRef = useRef(false);
  const [form, setForm] = useState({
    slug: '',
    display_name: auth.profile?.username ? '@' + auth.profile.username : '',
    avatar_url: '',
    website_url: '',
    telegram_url: auth.profile?.username ? 'https://t.me/' + auth.profile.username : '',
    bio: '',
    publish: true
  });

  function updateForm(key: string, value: any) {
    setProfileDirty(true);
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function loadProfile(force = false) {
    if (!auth.authenticated) return;
    if (!force && profileDirty) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await studio().authGetAuthorProfile();
      if (!result?.success) throw new Error(result?.error || 'Не удалось загрузить профиль автора.');
      const profile = result.profile || {};
      setForm({
        slug: profile.slug || '',
        display_name: profile.display_name || (auth.profile?.username ? '@' + auth.profile.username : ''),
        avatar_url: profile.avatar_url || '',
        website_url: profile.website_url || '',
        telegram_url: profile.telegram_url || (auth.profile?.username ? 'https://t.me/' + auth.profile.username : ''),
        bio: profile.bio || '',
        publish: profile.status ? profile.status === 'published' : true
      });
      setProfileDirty(false);
      loadedOnceRef.current = true;
      try {
        const stats = await studio().marketplaceGetStats();
        setPreviewProducts(arr(stats?.products).slice(0, 8));
      } catch {}
      setMessage('Профиль автора загружен.');
    } catch (e: any) {
      setMessage(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!auth.authenticated || loadedOnceRef.current) return;
    void loadProfile(true);
  }, [auth.authenticated]);

  async function saveProfile() {
    setSaving(true);
    setMessage('');
    const payload = {
      slug: form.slug.trim(),
      display_name: form.display_name.trim(),
      avatar_url: form.avatar_url.trim() || null,
      website_url: form.website_url.trim() || null,
      telegram_url: form.telegram_url.trim() || null,
      bio: form.bio.trim(),
      publish: !!form.publish
    };
    try {
      const result = await studio().authSaveAuthorProfile(payload);
      if (!result?.success) throw new Error(result?.error || 'Не удалось сохранить профиль автора.');
      setProfileDirty(false);
      setMessage('Профиль сохранён. Slug запомнен, страница автора готова к открытию.');
    } catch (e: any) {
      setMessage(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!auth.authenticated) return <GateCard onLogin={onLogin}/>;

  return <section className="settings-grid">
    <div className="card settings-form">
      <div className="section-head">
        <div><h3>Профиль разработчика</h3><p>Эти данные сохраняются через publisher author-profile API и используются на публичной странице автора.</p></div>
        <Button onClick={() => loadProfile(true)} disabled={loading} icon={loading ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>}>Обновить</Button>
      </div>
      <div className="form-grid wide author-profile-form" onPointerDown={e => e.stopPropagation()}>
        <label><span>Slug / адрес</span><input autoComplete="off" value={form.slug} onChange={e => updateForm('slug', e.currentTarget.value)} placeholder="andreycatser" /></label>
        <label><span>Имя автора</span><input autoComplete="off" value={form.display_name} onChange={e => updateForm('display_name', e.currentTarget.value)} placeholder="@AndreyCatser" /></label>
        <label><span>Telegram URL</span><input autoComplete="off" value={form.telegram_url} onChange={e => updateForm('telegram_url', e.currentTarget.value)} placeholder="https://t.me/AndreyCatser" /></label>
        <label><span>Сайт</span><input autoComplete="off" value={form.website_url} onChange={e => updateForm('website_url', e.currentTarget.value)} placeholder="https://..." /></label>
        <label className="full"><span>Аватар URL</span><input autoComplete="off" value={form.avatar_url} onChange={e => updateForm('avatar_url', e.currentTarget.value)} placeholder="https://... или пусто" /></label>
        <label className="full"><span>Описание</span><textarea value={form.bio} onChange={e => updateForm('bio', e.currentTarget.value)} rows={7} placeholder="Расскажи, кто ты и какие плагины делаешь." /></label>
      </div>
      <label className="check big"><input type="checkbox" checked={form.publish} onChange={e => updateForm('publish', e.currentTarget.checked)}/>Опубликовать страницу автора после сохранения</label>
      {message && <div className="inline-message">{message}</div>}
      <div className="row">
        <Button variant="primary" onClick={saveProfile} disabled={saving} icon={saving ? <Loader2 className="spin" size={15}/> : <Save size={15}/>}>Сохранить профиль</Button>
        <Button onClick={onOpenAuthor} icon={<ExternalLink size={15}/>}>Открыть страницу автора</Button>
      </div>
    </div>
    <div className="author-page-preview">
      <div className="author-hero-preview card">
        <div className="author-avatar-preview"><AvatarView src={form.avatar_url || (form.slug ? `https://funpaypulse.com/telegram-avatar/${encodeURIComponent(form.slug)}` : '')} name={form.display_name || form.slug} size={62} big/></div>
        <div className="author-hero-text">
          <span className="badge ok">{previewProducts.length || 0} плагинов</span>
          <h2>{form.display_name || '@author'}</h2>
          <small>@{form.slug || 'slug'}</small>
          <p>{form.bio || 'Описание пока пустое.'}</p>
        </div>
        <div className="author-preview-actions">{form.website_url && <button>Сайт <ExternalLink size={13}/></button>}{form.telegram_url && <button>Telegram <ExternalLink size={13}/></button>}</div>
      </div>
      <div className="author-filter-preview card">
        <div><Search size={15}/>Поиск по работам автора</div><div>Любая цена</div><div>Любые настройки</div>
      </div>
      <div className="author-products-preview">
        {(previewProducts.length ? previewProducts : [{name:'NeverBoost Auto Delivery', plugin_id:'neverboost_pulse', price_rub:400}, {name:'AutoTikTok', plugin_id:'auto_tiktok', price_rub:365}, {name:'Review Reminder', plugin_id:'review_reminder', price_rub:50}]).slice(0,3).map((p: any) => <div className="author-plugin-card card" key={p.public_id || p.plugin_id}>
          <div className="plugin-icon-mini"><Box size={20}/></div>
          <em>{p.price_rub ? rub(p.price_rub) : '—'}</em>
          <h3>{p.name || p.plugin_id}</h3>
          <small>{p.plugin_id} • v{p.current_version?.version || '1.0.0'}</small>
          <span>⭐ Нет отзывов</span>
          <p>{p.description || 'Карточка плагина в публичном профиле автора.'}</p>
        </div>)}
      </div>
    </div>
  </section>;
}

function StatsPage({ auth, onLogin }: { auth: AuthState; onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState('');

  async function loadStats() {
    if (!auth.authenticated) return;
    setLoading(true);
    setError('');
    try {
      const result = await studio().marketplaceGetStats();
      setStats(result);
      if (!result?.success && result?.errors?.length) {
        setError(result.errors.map((e: any) => `${e.name}: ${e.error}`).join('\n'));
      } else {
        setError('');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStats(); }, [auth.authenticated]);

  if (!auth.authenticated) return <GateCard onLogin={onLogin}/>;

  const installs = arr(stats?.installations);
  const tokens = arr(stats?.developerTokens);
  const ledgerItems = arr(stats?.ledger);
  const products = arr(stats?.products);
  const summary = stats?.ledger?.summary || {};
  const activeTokens = tokens.filter(t => t.status === 'active').length;
  const activeInstalls = installs.filter(i => i.status === 'active').length;
  const running = installs.filter(i => i.managed_runtime?.status === 'running' || i.runtime?.runtime_status === 'running').length;
  const totalQueued = installs.reduce((s, i) => s + Number(i.runtime?.queued_actions || 0), 0);
  const totalFailed = installs.reduce((s, i) => s + Number(i.runtime?.failed_actions || 0) + Number(i.runtime?.dead_actions || 0), 0);
  const approvedProducts = products.filter(p => p.review_state === 'approved').length;
  const pendingProducts = products.filter(p => String(p.visibility || '').includes('pending') || p.review_state === 'pending').length;

  return <section className="stats-page">
    <div className="section-head">
      <div><h2>Статистика разработчика</h2><p>Установки, продукты, доходы, developer-токены и dashboard по каждому плагину.</p></div>
      <Button variant="primary" onClick={loadStats} disabled={loading} icon={loading ? <Loader2 className="spin" size={16}/> : <RefreshCw size={16}/>}>Обновить</Button>
    </div>
    {error && <pre className="auth-error stats-error">{error}</pre>}
    <div className="stat-cards">
      <div className="stat-card card"><span>Баланс</span><b>{rub(summary.balance_rub)}</b><em>payable: {rub(summary.payable_rub)}</em></div>
      <div className="stat-card card"><span>Продажи</span><b>{rub(summary.gross_sales_rub)}</b><em>комиссия: {rub(summary.platform_fee_rub)}</em></div>
      <div className="stat-card card"><span>Холд</span><b>{rub(summary.held_rub)}</b><em>доступно: {rub(summary.available_rub)}</em></div>
      <div className="stat-card card"><span>Установки</span><b>{activeInstalls}/{installs.length}</b><em>running: {running}</em></div>
      <div className="stat-card card"><span>Продукты</span><b>{products.length}</b><em>approved: {approvedProducts}, pending: {pendingProducts}</em></div>
      <div className="stat-card card"><span>Developer tokens</span><b>{activeTokens}/{tokens.length}</b><em>active / total</em></div>
    </div>

    <ProductDashboard products={products} installs={installs} ledgerItems={ledgerItems}/>

    <div className="stats-grid">
      <div className="card stat-panel">
        <h3>Установки и runtime</h3>
        <div className="metric-line"><span>Очередь actions</span><b>{totalQueued}</b></div>
        <div className="metric-line"><span>Ошибки/dead actions</span><b>{totalFailed}</b></div>
        <div className="table-lite">
          {installs.slice(0,8).map(i => <div className="table-row" key={i.public_id}>
            <div><b>{i.plugin_name || i.plugin_id}</b><span>{i.version} • {i.runtime_type} • vps {i.vps_id || '—'}</span></div>
            <em className={cx('badge', statusClass(i.status))}>{i.status}</em>
          </div>)}
          {!installs.length && <p>Установок пока нет.</p>}
        </div>
      </div>

      <div className="card stat-panel">
        <h3>Продукты</h3>
        <div className="table-lite">
          {products.slice(0,8).map(p => <div className="table-row" key={p.public_id}>
            <div><b>{p.name || p.plugin_id}</b><span>{p.pricing_type} • {rub(p.price_rub)} • {p.current_version?.version || '—'}</span></div>
            <em className={cx('badge', statusClass(p.review_state || p.visibility))}>{p.review_state || p.visibility}</em>
          </div>)}
          {!products.length && <p>Продуктов пока нет.</p>}
        </div>
      </div>

      <DeveloperTokensPanel tokens={tokens} onRefresh={loadStats}/>

      <div className="card stat-panel">
        <h3>Лента доходов</h3>
        <div className="table-lite">
          {ledgerItems.slice(0,10).map(e => <div className="table-row" key={e.public_id}>
            <div><b>{e.product?.name || e.entry_type}</b><span>{e.entry_type} • {fmtDate(e.created_at)}</span></div>
            <em className={Number(e.amount_rub) >= 0 ? 'money plus' : 'money minus'}>{rub(e.amount_rub)}</em>
          </div>)}
          {!ledgerItems.length && <p>Записей дохода пока нет.</p>}
        </div>
      </div>
    </div>
  </section>;
}

function InnoUpdaterPanel() {
  const [info, setInfo] = useState<any>(null);
  const [manifestUrl, setManifestUrl] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [download, setDownload] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let off: any = null;
    (async () => {
      const result = await studio().updaterGetInfo();
      setInfo(result);
      setManifestUrl(result.manifestUrl || '');
      setDownload(result.downloadedUpdate || null);
    })();
    try {
      off = studio().updaterOnEvent((event: any) => {
        if (event?.type === 'download-progress') setProgress(event);
        if (event?.type === 'downloaded') setDownload(event.result);
      });
    } catch {}
    return () => { if (off) off(); };
  }, []);

  async function saveManifestUrl() {
    setBusy('save-url');
    try {
      const result = await studio().updaterSetManifestUrl(manifestUrl);
      if (!result?.success) throw new Error(result?.error || 'Не удалось сохранить update URL.');
      setInfo((prev: any) => ({ ...(prev || {}), manifestUrl: result.manifestUrl }));
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }

  async function checkUpdate() {
    setBusy('check');
    setProgress(null);
    try {
      const result = await studio().updaterCheckInno(manifestUrl);
      setCheckResult(result);
      if (!result?.success) throw new Error(result?.error || 'Не удалось проверить обновления.');
    } catch (e: any) {
      setCheckResult({ success: false, error: e?.message || String(e) });
    } finally {
      setBusy('');
    }
  }

  async function downloadUpdate() {
    if (!checkResult?.manifest) return;
    setBusy('download');
    setProgress(null);
    try {
      const result = await studio().updaterDownloadInno(checkResult.manifest);
      setDownload(result);
      if (!result?.success) throw new Error(result?.error || 'Не удалось скачать установщик.');
    } catch (e: any) {
      setDownload({ success: false, error: e?.message || String(e) });
    } finally {
      setBusy('');
    }
  }

  async function installUpdate() {
    if (!download?.path) return;
    if (!confirm('Запустить Inno Setup установщик и закрыть Studio?')) return;
    await studio().updaterInstallInno(download.path);
  }

  const pct = progress?.percent != null ? `${progress.percent}%` : '';
  const available = checkResult?.success && checkResult.available;

  return <div className="inno-updater card">
    <div className="section-head">
      <div><h3>Обновления через Inno Setup</h3><p>Studio проверяет JSON-манифест, скачивает новый .exe установщик, проверяет SHA-256 и запускает Inno installer.</p></div>
      <span className="version-badge">v{info?.currentVersion || '1.20.0'}</span>
    </div>
    <label className="updater-url"><span>Update manifest URL</span><input value={manifestUrl} onChange={e => setManifestUrl(e.currentTarget.value)} placeholder="https://.../latest.json" /></label>
    <div className="row">
      <Button onClick={saveManifestUrl} disabled={busy === 'save-url'} icon={<Save size={15}/>}>Сохранить URL</Button>
      <Button variant="primary" onClick={checkUpdate} disabled={busy === 'check'} icon={busy === 'check' ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>}>Проверить</Button>
      <Button onClick={downloadUpdate} disabled={!available || busy === 'download'} icon={busy === 'download' ? <Loader2 className="spin" size={15}/> : <Archive size={15}/>}>Скачать</Button>
      <Button onClick={installUpdate} disabled={!download?.success} icon={<Upload size={15}/>}>Запустить установщик</Button>
    </div>
    {checkResult && <div className={checkResult.success ? 'inline-message' : 'auth-error'}>
      {checkResult.success
        ? (checkResult.available ? `Доступна версия ${checkResult.latestVersion}. Текущая: ${checkResult.currentVersion}.` : `Обновлений нет. Текущая версия ${checkResult.currentVersion}.`)
        : checkResult.error}
      {checkResult?.manifest?.notes && <pre className="update-notes">{String(checkResult.manifest.notes).slice(0, 1200)}</pre>}
    </div>}
    {busy === 'download' && <div className="download-progress"><span style={{ width: pct || '35%' }} /> <b>{pct || 'скачивание...'}</b></div>}
    {download?.success && <div className="inline-message">Скачано: {download.filename || download.path}. SHA-256 {download.verified ? 'проверен' : 'не указан в манифесте'}.</div>}
    {download && !download.success && <div className="auth-error">{download.error}</div>}
    <div className="hint-box"><Info size={16}/>Пример latest.json: <code>{'{"version":"1.21.0","url":"https://.../PulsePluginStudioSetup-1.21.0.exe","sha256":"..." }'}</code></div>
  </div>;
}

function SettingsPage({ auth, prefs, setPrefs, onLogin, onOpenAuthor, addLog }: { auth: AuthState; prefs: StudioPrefs; setPrefs: (p: StudioPrefs) => void; onLogin: () => void; onOpenAuthor: () => Promise<void>; addLog: any }) {
  const [tab, setTab] = useState<'profile'|'general'|'info'>('profile');
  const links = [
    ['Сайт Pulse', 'https://funpaypulse.com/'],
    ['GitHub Plugin Studio', 'https://github.com/SystemHubC/PluginStudioPulse'],
    ['Telegram AndreyCatser', 'https://t.me/AndreyCatser'],
    ['Профиль разработчика', 'https://funpaypulse.com/plugins/authors/andreycatser']
  ];

  return <section className="settings-page">
    <div className="settings-tabs card">
      <button className={cx(tab === 'profile' && 'active')} onClick={() => setTab('profile')}><User size={16}/>Профиль</button>
      <button className={cx(tab === 'general' && 'active')} onClick={() => setTab('general')}><Settings size={16}/>Основное</button>
      <button className={cx(tab === 'info' && 'active')} onClick={() => setTab('info')}><Info size={16}/>Информация</button>
    </div>

    {tab === 'profile' && <AuthorProfileSettings auth={auth} onLogin={onLogin} onOpenAuthor={onOpenAuthor} addLog={addLog}/>}
    {tab === 'general' && <div className="card settings-form">
      <h3>Основные настройки</h3>
      <label className="check big"><input type="checkbox" checked={prefs.hideUnavailableTabs} onChange={e => setPrefs({ ...prefs, hideUnavailableTabs: e.target.checked })}/>Скрывать недоступные вкладки в гостевом режиме</label>
      <p>Если выключено, вкладка статистики остаётся видимой, но при нажатии просит войти в профиль Pulse.</p>
      <div className="hint-box"><Info size={16}/>SDK, проекты и локальные проверки доступны без входа. Профиль автора, статистика, продукты, доходы и developer-токены требуют авторизации.</div>
    </div>}
    {tab === 'info' && <div className="card settings-form info-panel">
      <h3>Pulse Plugin Studio</h3>
      <div className="version-badge">Версия программы 1.20</div>
      <p>Studio помогает создавать SDK-плагины FunPay Pulse: редактировать проект, собирать manifest/config, запускать check/test/doctor/pack, публиковать пакеты и смотреть данные аккаунта разработчика.</p>
      <InnoUpdaterPanel/>
      <div className="info-links">
        {links.map(([label, url]) => <button key={url} onClick={() => studio().openExternal(url)}><ExternalLink size={16}/>{label}</button>)}
      </div>
      <div className="hint-box"><ShieldCheck size={16}/>Авторизация работает через Telegram web-code. Raw developer-токены и Broker-токены не показываются в интерфейсе Studio.</div>
    </div>}
  </section>;
}


function App() {
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState('home');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [root, setRoot] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [auth, setAuth] = useState<AuthState>({ loading: true, authenticated: false, profile: null });
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authCode, setAuthCode] = useState<any>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authDeadline, setAuthDeadline] = useState(0);
  const [authTick, setAuthTick] = useState(Date.now());
  const [authGate, setAuthGate] = useState(false);
  const [marketplaceEditorOpen, setMarketplaceEditorOpen] = useState(false);
  const [prefs, setPrefsState] = useState<StudioPrefs>(() => {
    try { return { hideUnavailableTabs: localStorage.getItem('pulse-studio-hide-unavailable-tabs') === '1' }; }
    catch { return { hideUnavailableTabs: false }; }
  });
  const bridgeMissing = !window.studio;
  const current = projects.find(p => p.id === projectId);
  const visibleNav = nav.filter(item => !(item.authRequired && prefs.hideUnavailableTabs && !auth.authenticated));
  function savePrefs(next: StudioPrefs) {
    setPrefsState(next);
    try { localStorage.setItem('pulse-studio-hide-unavailable-tabs', next.hideUnavailableTabs ? '1' : '0'); } catch {}
  }
  function openPage(id: string, authRequired?: boolean) {
    if (authRequired && !auth.authenticated) {
      setAuthGate(true);
      return;
    }
    setPage(id);
  }

  async function refreshProjects(nextId?: string) {
    if (!window.studio) return;
    const rows = await studio().listProjects();
    setProjects(rows);
    if (nextId) setProjectId(nextId);
    else if (!projectId && rows[0]) setProjectId(rows[0].id);
  }
  async function refreshTree() {
    if (!projectId) return;
    const r = await studio().getTree(projectId);
    setTree(r.tree); setRoot(r.root);
    setReports(await studio().getSessionReports(projectId));
  }
  useEffect(() => { if (window.studio) refreshProjects(); }, []);
  useEffect(() => { refreshTree(); }, [projectId]);
  useEffect(() => {
    if (page === 'stats' && prefs.hideUnavailableTabs && !auth.authenticated) setPage('home');
  }, [page, prefs.hideUnavailableTabs, auth.authenticated]);

  useEffect(() => {
    if (!window.studio) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await studio().authGetState();
        if (cancelled) return;
        if (result?.success && result?.authenticated && result?.profile) {
          setAuth({ loading: false, authenticated: true, profile: result.profile });
        } else {
          setAuth({ loading: false, authenticated: false, profile: null, error: result?.error });
          if (!localStorage.getItem('pulse-studio-login-prompt-v1')) setShowFirstLogin(true);
        }
      } catch (e: any) {
        if (cancelled) return;
        setAuth({ loading: false, authenticated: false, profile: null, error: e?.message || String(e) });
        if (!localStorage.getItem('pulse-studio-login-prompt-v1')) setShowFirstLogin(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loginOpen || !authCode?.code) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      setAuthTick(Date.now());
      if (authDeadline && Date.now() > authDeadline) {
        setAuthError('Код истёк. Нажми “Получить код” и попробуй снова.');
        return;
      }
      try {
        const result = await studio().authTelegramPoll(authCode.code);
        if (cancelled) return;
        if (result?.verified) {
          const profile = result.profile || null;
          setAuth({ loading: false, authenticated: !!profile, profile, error: profile ? undefined : 'Telegram подтверждён, но профиль не загрузился.' });
          setLoginOpen(false);
          setAuthCode(null);
          setAuthError('');
          await pushLog('auth: telegram login', { success: !!profile, profile, profileResult: result.profileResult });
        } else if (!result?.success) {
          setAuthError(result?.error || 'Не удалось проверить код.');
        }
      } catch (e: any) {
        if (!cancelled) setAuthError(e?.message || String(e));
      }
    };
    const pollTimer = window.setInterval(poll, 2500);
    const clockTimer = window.setInterval(() => setAuthTick(Date.now()), 1000);
    void poll();
    return () => { cancelled = true; window.clearInterval(pollTimer); window.clearInterval(clockTimer); };
  }, [loginOpen, authCode?.code, authDeadline]);

  async function startTelegramLogin() {
    localStorage.setItem('pulse-studio-login-prompt-v1', '1');
    setShowFirstLogin(false);
    setLoginOpen(true);
    setAuthCode(null);
    setAuthError('');
    setAuthBusy(true);
    try {
      const result = await studio().authTelegramInit();
      if (!result?.success) throw new Error(result?.error || 'Не удалось получить Telegram-код.');
      setAuthCode(result);
      setAuthDeadline(Date.now() + Number(result.expires_in || 180) * 1000);
      setAuthTick(Date.now());
    } catch (e: any) {
      setAuthError(e?.message || String(e));
    } finally {
      setAuthBusy(false);
    }
  }

  function declineFirstLogin() {
    localStorage.setItem('pulse-studio-login-prompt-v1', '1');
    setShowFirstLogin(false);
    setAuth({ loading: false, authenticated: false, profile: null });
  }

  async function openTelegramBot(code: string, bot_username: string) {
    const result = await studio().authOpenTelegram({ code, bot_username });
    if (!result?.success) setAuthError(result?.error || 'Не удалось открыть Telegram.');
  }

  async function logoutProfile() {
    const result = await studio().authLogout();
    setAuth({ loading: false, authenticated: false, profile: null });
    await pushLog('auth: logout', result || { success: true });
  }

  async function openAuthorProfile() {
    const result = await studio().authOpenAuthorProfile();
    await pushLog('auth: open developer profile', result);
  }

  function errorResult(e: any) {
    return { success: false, error: e?.message || String(e), stack: e?.stack || undefined };
  }

  async function pushLog(title: string, result: any) {
    setLogs(l => [{ id: crypto.randomUUID(), title, result, time: new Date().toLocaleTimeString() }, ...l]);
    if (projectId) {
      try { setReports(await studio().getSessionReports(projectId)); } catch {}
    }
    if (page !== 'logs') setPage('logs');
    return result;
  }

  async function addLog(title: string, p: Promise<any>) {
    setBusy(title);
    let result: any;
    try {
      result = await p;
    } catch (e) {
      result = errorResult(e);
    } finally {
      setBusy('');
    }
    return await pushLog(title, result);
  }

  async function runUiAction<T>(title: string, action: () => Promise<T>) {
    setBusy(title);
    try {
      return await action();
    } catch (e) {
      await pushLog(title, errorResult(e));
      return null;
    } finally {
      setBusy('');
    }
  }

  function requireProject(title: string) {
    if (projectId) return true;
    void pushLog(title, { success: false, error: 'Сначала создай или импортируй проект, потом запускай проверку.' });
    return false;
  }

  async function runPreset(preset: string) {
    if (!requireProject(`preset: ${preset}`)) return;
    await addLog(`preset: ${preset}`, studio().runCommand(projectId, preset));
  }

  async function ensureSdk() {
    if (!requireProject('ensure SDK')) return;
    await addLog('ensure SDK', studio().ensureSdk(projectId));
  }

  async function fixSsl() {
    if (!requireProject('fix SSL / certifi')) return;
    await addLog('fix SSL / certifi', studio().fixSsl(projectId));
  }

  async function openFile(rel: string) {
    if (dirty && activeFile) await saveFile();
    const text = await studio().readFile(projectId, rel);
    setActiveFile(rel); setContent(text); setDirty(false);
    setOpenFiles(files => files.includes(rel) ? files : [...files, rel]);
  }
  async function saveFile() {
    if (!projectId || !activeFile) return;
    await studio().writeFile(projectId, activeFile, content);
    setDirty(false); await refreshTree();
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [projectId, activeFile, content]);

  async function createEntry(parent: string, type: 'file'|'directory') {
    if (!projectId) return;
    const name = prompt(type === 'file' ? 'Имя файла' : 'Имя папки', type === 'file' ? 'new_file.py' : 'new_folder');
    if (!name) return;
    await studio().createEntry(projectId, [parent, name].filter(Boolean).join('/'), type);
    await refreshTree();
  }
  async function renameEntry(rel: string) {
    const next = prompt('Новый путь/имя', rel); if (!next || next === rel) return;
    await studio().renameEntry(projectId, rel, next);
    if (activeFile === rel) setActiveFile(next);
    setOpenFiles(files => files.map(f => f === rel ? next : f)); await refreshTree();
  }
  async function deleteEntry(rel: string) {
    if (!confirm(`Удалить ${rel}?`)) return;
    await studio().deleteEntry(projectId, rel);
    if (activeFile === rel || activeFile.startsWith(rel + '/')) { setActiveFile(''); setContent(''); }
    setOpenFiles(files => files.filter(f => f !== rel && !f.startsWith(rel + '/'))); await refreshTree();
  }
  async function createProject() {
    const id = prompt('ID плагина', 'seller_auto_reply'); if (!id) return;
    const title = prompt('Название', 'Seller Auto Reply') || id;
    const created = await runUiAction('create project', () => studio().createProject({ id, title, template: 'broker-poller' }));
    if (created) { await refreshProjects(created.id); setPage('editor'); }
  }
  async function importFolder() {
    const imported = await runUiAction('import folder', () => studio().importFolder());
    if (imported) { await refreshProjects(imported.id); setPage('editor'); }
  }
  async function importArchive() {
    const imported = await runUiAction('import archive', () => studio().importArchive());
    if (imported) { await refreshProjects(imported.id); setPage('editor'); }
  }
  function applyMarketplaceJson(next: string) {
    setContent(next);
    setDirty(true);
  }
  async function renameActiveFile() {
    if (!activeFile) return;
    await renameEntry(activeFile);
  }

  const filteredTree = useMemo(() => {
    if (!query.trim()) return tree;
    const q = query.toLowerCase();
    function filter(nodes: FileNode[]): FileNode[] {
      return nodes.map(n => ({...n, children: n.children ? filter(n.children) : undefined}))
        .filter(n => n.name.toLowerCase().includes(q) || (n.children && n.children.length));
    }
    return filter(tree);
  }, [tree, query]);
  const authTimeLeft = authDeadline ? Math.max(0, Math.ceil((authDeadline - authTick) / 1000)) : 0;

  if (!loaded) return <><WindowTitlebar/><Splash done={() => setLoaded(true)} /></>;
  if (bridgeMissing) return <div className="window-root"><WindowTitlebar/><div className="bridge-error card">
    <XCircle size={42}/>
    <h1>Electron bridge не загружен</h1>
    <p>Файлы, импорт папок/архивов и SDK-команды работают только внутри Electron-окна. Не открывай <code>http://localhost:5173</code> в обычном браузере — запускай <code>run-dev.bat</code>, <code>pnpm dev</code> или собранный <code>.exe</code>.</p>
    <p>Если это сообщение видно именно в Electron, значит не загрузился preload. В v9 добавлена диагностика preload-error и поиск <code>preload.js</code> в нескольких путях.</p>
  </div></div>;

  return <><div className="window-root"><WindowTitlebar/><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img src={iconUrl}/><div><b>Plugin Studio</b><span>FunPay Pulse SDK</span></div></div>
      <div className="project-picker"><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Нет проекта</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <nav>{visibleNav.map(item => { const Icon = item.icon; const locked = !!item.authRequired && !auth.authenticated; return <button key={item.id} className={cx(page === item.id && 'active', locked && 'locked')} onClick={() => openPage(item.id, item.authRequired)}><Icon size={18}/>{item.label}{locked && <span className="nav-lock">вход</span>}</button>; })}</nav>
      <div className="side-bottom"><span>{current?.name || 'Создай или импортируй проект'}</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><h2>{nav.find(n => n.id === page)?.label || 'Plugin Studio'}</h2><p>{root || 'Отдельная программа для разработки SDK-плагинов Pulse'}</p></div><div className="top-actions"><Button onClick={createProject} icon={<Plus size={16}/>}>Создать</Button><Button onClick={importFolder} icon={<FolderOpen size={16}/>}>Папка</Button><Button onClick={importArchive} icon={<Archive size={16}/>}>Архив</Button><Button variant="primary" onClick={() => refreshProjects()} icon={<RefreshCw size={16}/>}>Обновить</Button><ProfileButton auth={auth} onLogin={startTelegramLogin} onLogout={logoutProfile} onOpenAuthor={openAuthorProfile} addLog={addLog}/></div></header>
      {busy && <div className="busy"><Loader2 className="spin" size={16}/>{busy}</div>}

      {page === 'home' && <section className="home-grid">
        <div className="hero card"><div className="hero-kicker"><Sparkles size={16}/>Pulse SDK Workspace</div><h1>Создавай плагины быстрее</h1><p>Стартовая страница, редактор, конструктор настроек, проверки SDK и понятные подсказки по каждому сбою.</p><div className="row"><Button variant="primary" onClick={createProject} icon={<Plus size={16}/>}>Создать плагин</Button><Button onClick={importFolder} icon={<Upload size={16}/>}>Импорт папки</Button><Button onClick={importArchive} icon={<Archive size={16}/>}>Импорт архива</Button></div></div>
        <SdkChecklist projectId={projectId} root={root} onEnsure={ensureSdk} onRun={runPreset} />
        <div className="card status-card"><h3>Окружение</h3><button onClick={ensureSdk}><Hammer size={17}/>Установить / починить SDK</button><button onClick={fixSsl}><ShieldCheck size={17}/>Исправить SSL</button><button onClick={() => root && studio().openPath(root)}><FolderOpen size={17}/>Открыть папку</button></div>
        <div className="card recent"><h3>Последние проекты</h3>{projects.length === 0 && <p>Пока нет проектов. Создай первый или импортируй папку.</p>}{projects.slice(0,5).map(p => <button key={p.id} className={cx(projectId === p.id && 'active')} onClick={() => { setProjectId(p.id); setPage('editor'); }}><b>{p.name}</b><span>{p.actualRoot}</span></button>)}</div>
      </section>}

      {page === 'editor' && <section className="editor-layout"><div className="files-pane card"><div className="pane-title"><b>Файлы</b><div><button onClick={() => createEntry('', 'file')}>+ файл</button><button onClick={() => createEntry('', 'directory')}>+ папка</button></div></div><div className="search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск файлов" /></div><FileTree nodes={filteredTree} active={activeFile} onOpen={openFile} onCreate={createEntry} onRename={renameEntry} onDelete={deleteEntry}/></div><div className="code-pane card"><div className="tabs">{openFiles.map(f => <button key={f} className={cx(activeFile === f && 'active')} onClick={() => openFile(f)}>{f}{activeFile === f && dirty ? ' •' : ''}</button>)}</div><div className="editor-toolbar"><span>{activeFile || 'Открой файл'}</span><div className="editor-toolbar-actions"><Button disabled={!activeFile} onClick={renameActiveFile} icon={<Wand2 size={15}/>}>Переименовать</Button>{activeFile === 'funpay-pulse.marketplace.json' && <Button onClick={() => setMarketplaceEditorOpen(true)} icon={<SlidersHorizontal size={15}/>}>Редактор</Button>}<Button disabled={!activeFile} onClick={saveFile} variant="primary" icon={<Save size={15}/>}>Сохранить</Button></div></div>{activeFile ? <Editor height="100%" theme="vs-dark" language={lang(activeFile)} value={content} onChange={(v) => { setContent(v || ''); setDirty(true); }} options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 14, fontFamily: 'JetBrains Mono, Consolas, monospace', lineNumbers: 'on', scrollBeyondLastLine: false, tabSize: 2 }} /> : <div className="empty"><Code2 size={42}/><p>Выбери файл слева или создай новый</p></div>}</div></section>}
      {page === 'config' && <ConfigBuilder projectId={projectId} addLog={addLog}/>} 
      {page === 'doctor' && <section className="doctor-grid"><div className="stack card doctor-main"><h3>Doctor / Test</h3><p>Запускает SDK-команды в корне проекта. Trusted определяется автоматически по scopes, а SDK при необходимости ставится в .venv сам.</p><div className="commands"><Button onClick={ensureSdk} variant="primary">Установить / починить SDK</Button><Button onClick={fixSsl}>Исправить SSL / certifi</Button>{['validate', 'check', 'test', 'doctor', 'pack', 'dry-run', 'run-fixtures'].map(p => <Button key={p} onClick={() => runPreset(p)}>{p}</Button>)}</div><TerminalLite projectId={projectId} addLog={addLog}/></div><SdkChecklist projectId={projectId} root={root} onEnsure={ensureSdk} onRun={runPreset} /></section>}
      {page === 'publish' && <section className="publish-security-wrap"><SecurityScanCard projectId={projectId}/><Publish projectId={projectId} addLog={addLog}/></section>} 
      {page === 'stats' && <StatsPage auth={auth} onLogin={startTelegramLogin}/>}
      {page === 'logs' && <section className="logs"><div className="card session-card"><div><h3>Отчёты сессий</h3><p>Команды SDK, Doctor, Pack, Publish и фиксы сохраняются в проекте в `.plugin-studio/sessions`.</p></div><Button disabled={!projectId} onClick={() => projectId && studio().openSessionFolder(projectId)}>Открыть папку отчётов</Button>{reports.slice(0,8).map(r => <div className="report-row" key={r.path}><span>{r.name}</span><b>{Math.ceil(r.size/1024)} KB</b></div>)}</div>{logs.length ? logs.map(l => <LogCard key={l.id} item={l}/>) : <div className="empty card"><Terminal size={42}/><p>Логов пока нет</p></div>}</section>}
      {page === 'settings' && <SettingsPage auth={auth} prefs={prefs} setPrefs={savePrefs} onLogin={startTelegramLogin} onOpenAuthor={openAuthorProfile} addLog={addLog}/>}
    </main>
  </div></div>{showFirstLogin && <FirstLoginPrompt onAccept={startTelegramLogin} onDecline={declineFirstLogin}/>}<TelegramLoginModal open={loginOpen} authCode={authCode} timeLeft={authTimeLeft} busy={authBusy} error={authError} onStart={startTelegramLogin} onClose={() => { setLoginOpen(false); setAuthCode(null); setAuthError(''); }} onOpenBot={openTelegramBot}/><MarketplaceMetadataEditor open={marketplaceEditorOpen} content={content} onApply={applyMarketplaceJson} onClose={() => setMarketplaceEditorOpen(false)}/>{authGate && <div className="modal-backdrop"><div className="first-login-modal card"><div className="modal-icon"><User size={28}/></div><h2>Требуется вход</h2><p>Чтобы открыть статистику, продукты, доходы и developer-токены, войди в профиль FunPay Pulse.</p><div className="modal-actions"><Button variant="primary" onClick={() => { setAuthGate(false); startTelegramLogin(); }} icon={<LogIn size={16}/>}>Войти</Button><Button onClick={() => setAuthGate(false)}>Позже</Button></div></div></div>}</>;
}

createRoot(document.getElementById('root')!).render(<App />);
