const API_BASE = (document.querySelector('meta[name="api-base"]')?.content ?? '').replace(/\/$/, '');
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_MB = 5;
const MAX_PET_IMAGES = 5;

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
let disposers = [];

// Plantillas HTML con escape automático: todo valor interpolado se escapa salvo que sea raw().
class Raw { constructor(value) { this.value = value; } }
const raw = (value) => new Raw(value);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toHtml = (value) => value instanceof Raw ? value.value
  : Array.isArray(value) ? value.map(toHtml).join('')
    : value === false || value === null || value === undefined ? '' : esc(value);
const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? toHtml(values[i]) : ''), ''));
const setHtml = (element, template) => { element.innerHTML = template instanceof Raw ? template.value : String(template ?? ''); return element; };

const icon = (name) => raw(`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`);
const norm = (text) => String(text).toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const hue = (text) => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const plural = (n, one, many) => `${n.toLocaleString('es')} ${n === 1 ? one : many}`;
const formatAge = (n) => plural(Number(n), 'año', 'años');
const petTitle = (pet) => `${pet.especie} · ${pet.color}`;
// Solo se muestran imágenes publicadas por el backend.
const imgUrl = (url) => /^\/img\/(users|pets)\/[\w.-]+$/.test(url ?? '') ? API_BASE + url : '';
const uniqueBy = (values) => [...new Map(values.map((v) => [norm(v), v])).values()];


// API REST del mismo servidor; no requiere una sesión.
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const pending = new Map();
function api(path, { method = 'GET', body } = {}) {
  if (method === 'GET' && pending.has(path)) return pending.get(path);
  const request = send(path, method, body);
  if (method === 'GET') {
    pending.set(path, request);
    request.finally(() => pending.delete(path)).catch(() => {});
  }
  return request;
}
async function send(path, method, body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  let response;
  try { response = await fetch(API_BASE + path, init); }
  catch { throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba que esté encendido e inténtalo de nuevo.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error ?? `Error ${response.status}`);
  return data;
}

function toast(message, type = 'ok') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  const box = document.getElementById('toasts');
  box.append(element);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => element.remove(), 4500);
}

function confirmDialog({ title, message, confirmText = 'Eliminar', danger = true }) {
  const dialog = document.getElementById('confirm-dialog');
  dialog.querySelector('#confirm-title').textContent = title;
  dialog.querySelector('#confirm-msg').textContent = message;
  const ok = dialog.querySelector('#confirm-ok');
  ok.textContent = confirmText;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-dark'}`;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

function avatar(user, size = 24) {
  const style = `--size:${size}px;--hue:${hue(user?.username ?? '?')}`;
  const url = imgUrl(user?.avatar);
  if (url) return html`<img class="avatar" src="${url}" alt="Avatar de ${user.username}" width="${size}" height="${size}" style="${style}">`;
  return html`<span class="avatar" style="${style}" aria-hidden="true">${(user?.username ?? '?')[0].toUpperCase()}</span>`;
}

const placeholder = (pet) => html`<div class="ph" style="--hue:${hue(pet.especie)}">${icon('paw')}<span>${pet.especie}</span><span class="small">Sin imágenes</span></div>`;

const loadingBlock = (text = 'Cargando…') => html`<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${text}</div>`;

const skeletonGrid = (n) => html`<div class="grid" aria-busy="true" aria-label="Cargando mascotas">${Array.from({ length: n }, () => html`<div class="shot skeleton"><div class="shot-thumb"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`)}</div>`;

function stateBlock({ iconName, title, text, action = '' }) {
  return html`<div class="state"><span class="state-icon">${icon(iconName)}</span><h2>${title}</h2><p>${text}</p>${action}</div>`;
}

function errorState(error) {
  return html`<div class="state state-error" role="alert">
    <span class="state-icon">${icon('alert')}</span>
    <h2>${error.status === 0 ? 'Sin conexión con el servidor' : 'No se pudo cargar la información'}</h2>
    <p>${error.message}</p>
    <button class="btn btn-dark" type="button" data-action="retry">Reintentar</button>
  </div>`;
}

function field(name, label, { type = 'text', value = '', autocomplete = 'off', full = false, hint = '', extra = '' } = {}) {
  return html`<div class="field${full ? ' full' : ''}">
    <label for="f-${name}">${label}</label>
    <input class="input" id="f-${name}" name="${name}" type="${type}" value="${value}" autocomplete="${autocomplete}" aria-describedby="e-${name}${hint ? ` h-${name}` : ''}" ${raw(extra)}>
    ${hint ? html`<p class="hint" id="h-${name}">${hint}</p>` : ''}
    <p class="field-error" id="e-${name}"></p>
  </div>`;
}

// Marca los campos con error, muestra el mensaje junto a cada uno y enfoca el primero.
function showErrors(form, errors) {
  for (const input of form.querySelectorAll('.input[name]')) {
    const message = errors[input.name] ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    const box = form.querySelector(`#e-${input.name}`);
    if (box) box.textContent = message;
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
  return Object.keys(errors).length === 0;
}

// Deshabilita el botón mientras dura la operación para evitar envíos duplicados.
async function submitting(button, busyText, task, alertBox) {
  if (button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setHtml(button, html`<span class="spinner" aria-hidden="true"></span>${busyText}`);
  if (alertBox) alertBox.hidden = true;
  try {
    await task();
  } catch (error) {
    if (error.handled) return;
    if (alertBox) {
      alertBox.textContent = error.message;
      alertBox.hidden = false;
      alertBox.focus();
    } else {
      toast(error.message, 'error');
    }
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = original;
  }
}

function checkImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) return `"${file.name}" no es una imagen JPG, PNG, GIF o WEBP`;
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) return `"${file.name}" pesa más de ${MAX_IMAGE_MB} MB`;
  return '';
}

const pickerTemplate = (id, max, title) => html`<div class="picker" data-picker="${id}">
  <label class="dropzone" for="${id}">
    <input class="sr-only" id="${id}" type="file" accept="${IMAGE_TYPES.join(',')}" ${max > 1 ? raw('multiple') : ''}>
    <span class="dz-icon">${icon('upload')}</span>
    <strong>${title}</strong>
    <span class="muted small">JPG, PNG, GIF o WEBP · máximo ${MAX_IMAGE_MB} MB por imagen · <span class="picker-count">0 de ${max}</span></span>
  </label>
  <p class="field-error picker-error" role="alert"></p>
  <div><button class="btn btn-soft btn-sm" type="button" data-picker-clear hidden>Limpiar selección</button></div>
  <div class="previews"></div>
</div>`;

// Selector de imágenes con previsualización, arrastrar y soltar, y opción de quitar antes de enviar.
function imagePicker(root, max, onChange) {
  const files = [];
  let urls = [];
  const input = root.querySelector('input[type="file"]');
  const list = root.querySelector('.previews');
  const error = root.querySelector('.picker-error');
  const zone = root.querySelector('.dropzone');
  const clear = root.querySelector('[data-picker-clear]');

  const draw = () => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = files.map((file) => URL.createObjectURL(file));
    setHtml(list, html`${files.map((file, i) => html`<figure class="preview">
      <img src="${urls[i]}" alt="Vista previa de ${file.name}">
      ${i === 0 && max > 1 ? html`<figcaption>Portada</figcaption>` : ''}
      <button class="preview-remove" type="button" data-index="${i}" aria-label="Quitar ${file.name}">${icon('x')}</button>
    </figure>`)}`);
    root.querySelector('.picker-count').textContent = `${files.length} de ${max}`;
    clear.hidden = !files.length && !error.textContent;
    onChange?.(files);
  };
  const add = (selected) => {
    if ((max === 1 ? 0 : files.length) + selected.length > max) {
      error.textContent = `Puedes seleccionar máximo ${max} ${max === 1 ? 'imagen' : 'imágenes'}. Vuelve a elegir los archivos.`;
      clear.hidden = false;
      return;
    }
    const problems = selected.map(checkImage).filter(Boolean);
    if (problems.length) { error.textContent = problems.join('. '); clear.hidden = false; return; }
    error.textContent = '';
    if (max === 1 && selected.length) files.length = 0;
    files.push(...selected);
    draw();
  };

  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (!button) return;
    files.splice(Number(button.dataset.index), 1);
    error.textContent = '';
    draw();
    input.focus();
  });
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('dragover'); add([...event.dataTransfer.files]); });
  clear.addEventListener('click', () => { files.length = 0; error.textContent = ''; input.value = ''; draw(); input.focus(); });

  disposers.push(() => urls.forEach((url) => URL.revokeObjectURL(url)));
  return { files, get valid() { return !error.textContent; }, clear() { files.length = 0; error.textContent = ''; draw(); } };
}

// Navegación de la plantilla, con rutas propias de los dos recursos disponibles.
const go = (path) => {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
};
function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}
function mount(template) {
  disposers.forEach((dispose) => dispose());
  disposers = [];
  const view = document.createElement('div');
  setHtml(view, template);
  app.replaceChildren(view);
  return view;
}
function renderHeader(path, params) {
  const current = (target) => (target === '/' ? path === '/' : path.startsWith(target)) ? raw('aria-current="page"') : '';
  const scope = path.startsWith('/usuarios') ? 'usuarios' : 'mascotas';
  setHtml(topbar, html`
    <a class="brand" href="#/" aria-label="huellas, ir al inicio">${icon('paw')}<span>huellas</span></a>
    <form class="search" role="search" id="search-form">
      <label class="sr-only" for="q">Buscar</label>
      <input id="q" name="q" type="search" placeholder="¿Qué estás buscando?" autocomplete="off" value="${params.get('q') ?? ''}">
      <label class="sr-only" for="scope">Buscar en</label>
      <select id="scope" name="scope">
        <option value="mascotas" ${scope === 'mascotas' ? raw('selected') : ''}>Mascotas</option>
        <option value="usuarios" ${scope === 'usuarios' ? raw('selected') : ''}>Usuarios</option>
      </select>
      <button class="search-btn" type="submit" aria-label="Buscar">${icon('search')}</button>
    </form>
    <nav class="nav" aria-label="Principal">
      <a href="#/" ${current('/')}>Inicio</a>
      <a href="#/mascotas" ${current('/mascotas')}>Mascotas</a>
      <a href="#/usuarios" ${current('/usuarios')}>Usuarios</a>
    </nav>
    <div class="top-actions"><a class="btn btn-dark new-pet" href="#/mascotas/nueva" aria-label="Registrar mascota">${icon('plus')}<span>Nueva mascota</span></a></div>`);
}
topbar.addEventListener('submit', (event) => {
  event.preventDefault();
  const { q, scope } = event.target.elements;
  go(`/${scope.value}${q.value.trim() ? `?q=${encodeURIComponent(q.value.trim())}` : ''}`);
});
app.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="retry"]')) render();
});
document.querySelector('.skip-link').addEventListener('click', (event) => { event.preventDefault(); app.focus(); });

function petCard(pet) {
  const cover = imgUrl(pet.img[0]);
  const title = petTitle(pet);
  return html`<article class="shot" aria-labelledby="pet-${pet.id}">
    <div class="shot-thumb">
      <a class="shot-link" href="#/mascotas/${pet.id}" tabindex="-1" aria-hidden="true">${cover ? html`<img src="${cover}" alt="" loading="lazy">` : placeholder(pet)}</a>
      <div class="shot-overlay"><span class="shot-overlay-title">${title}</span><span class="shot-actions">
        <a class="round-btn" href="#/mascotas/${pet.id}/editar" aria-label="Editar ${title}" title="Editar">${icon('edit')}</a>
        <button class="round-btn" type="button" data-delete-pet="${pet.id}" aria-label="Eliminar ${title}" title="Eliminar">${icon('trash')}</button>
      </span></div>
    </div>
    <div class="shot-meta">
      <div class="shot-row"><h3 class="shot-title" id="pet-${pet.id}"><a href="#/mascotas/${pet.id}">${title}</a></h3><span class="muted small">${formatAge(pet.edad)}</span></div>
      <div class="shot-row"><span class="muted small">${pet.sexo} · ID ${pet.id}</span><span class="stats"><span>${icon('image')}<span class="sr-only">Imágenes:</span>${pet.img.length}</span></span></div>
    </div>
  </article>`;
}

async function deleteRecord(resource, record) {
  const pet = resource === 'pets';
  const title = pet ? petTitle(record) : `${record.firstname} ${record.lastname}`;
  const message = pet
    ? `Se eliminará “${title}” (ID ${record.id}) junto con sus imágenes. Esta acción no se puede deshacer.`
    : `Se eliminará “${title}” y su avatar. Las mascotas se conservarán. Esta acción no se puede deshacer.`;
  if (!await confirmDialog({ title: pet ? '¿Eliminar esta mascota?' : '¿Eliminar este usuario?', message })) return false;
  try {
    await api(`/api/${resource}/${record.id}`, { method: 'DELETE' });
    toast(pet ? 'Mascota eliminada' : 'Usuario eliminado');
    return true;
  } catch (error) { toast(error.message, 'error'); return false; }
}

async function viewDashboard() {
  const quick = [
    ['#/mascotas', 'grid', 'Explorar mascotas', 'Consulta las fotos y los datos registrados.'],
    ['#/mascotas/nueva', 'plus', 'Registrar mascota', 'Agrega una mascota y sus imágenes.'],
    ['#/usuarios', 'user', 'Ver usuarios', 'Consulta y actualiza sus datos.'],
    ['#/usuarios/nuevo', 'plus', 'Registrar usuario', 'Agrega un usuario y su avatar.'],
  ];
  const view = mount(html`<div class="page">
    <section class="hello"><div><p class="eyebrow">Panel general</p><h1>Usuarios y mascotas</h1><p class="muted">Un espacio para consultar sus registros y mantener sus datos al día.</p></div><a class="btn btn-accent" href="#/mascotas/nueva">${icon('plus')}Registrar mascota</a></section>
    <div data-slot="stats">${loadingBlock('Cargando resumen…')}</div>
    <nav class="quick" aria-label="Accesos rápidos">${quick.map(([href, name, title, text]) => html`<a href="${href}"><span class="quick-icon">${icon(name)}</span><span><strong>${title}</strong><span class="muted">${text}</span></span></a>`)}</nav>
    <div class="section-head"><h2>Mascotas registradas</h2><a class="link" href="#/mascotas">Ver todas</a></div>
    <div data-slot="recent">${skeletonGrid(4)}</div>
  </div>`);
  const slot = (name, content) => setHtml(view.querySelector(`[data-slot="${name}"]`), content);
  try {
    const [pets, users] = await Promise.all([api('/api/pets'), api('/api/users')]);
    if (!view.isConnected) return;
    const stats = [[pets.length, 'Mascotas registradas'], [users.length, 'Usuarios registrados'], [pets.filter((pet) => pet.img.length).length, 'Mascotas con imágenes'], [pets.reduce((sum, pet) => sum + pet.img.length, 0), 'Imágenes de mascotas']];
    slot('stats', html`<div class="stat-grid">${stats.map(([n, label]) => html`<div class="stat"><b>${n.toLocaleString('es')}</b><span>${label}</span></div>`)}</div>`);
    slot('recent', pets.length ? html`<div class="grid">${[...pets].sort((a, b) => b.id - a.id).slice(0, 8).map(petCard)}</div>` : stateBlock({ iconName: 'paw', title: 'Todavía no hay mascotas', text: 'Registra la primera mascota para empezar a llenar este espacio.', action: html`<a class="btn btn-dark" href="#/mascotas/nueva">Registrar la primera</a>` }));
    view.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-delete-pet]');
      if (!button) return;
      button.disabled = true;
      if (await deleteRecord('pets', pets.find((pet) => pet.id === Number(button.dataset.deletePet)))) render();
      else button.disabled = false;
    });
  } catch (error) { slot('stats', errorState(error)); slot('recent', ''); }
}

const SORTS = [['recent', 'Recientes'], ['oldest', 'Más antiguas'], ['young', 'Menor edad'], ['old', 'Mayor edad']];
const SORTERS = { recent: (a, b) => b.id - a.id, oldest: (a, b) => a.id - b.id, young: (a, b) => a.edad - b.edad || b.id - a.id, old: (a, b) => b.edad - a.edad || b.id - a.id };

async function viewPets({ params }) {
  const filters = { tab: params.get('tab') ?? 'all', sort: SORTERS[params.get('sort')] ? params.get('sort') : 'recent', sexo: params.get('sexo') ?? '', fotos: params.get('fotos') === '1', q: params.get('q') ?? '' };
  const view = mount(html`<div class="page">
    <div class="page-head"><div><p class="eyebrow">Galería</p><h1>Mascotas</h1><p class="muted">Sus fotos, sus detalles y todo lo que necesitas para mantener el registro al día.</p></div><a class="btn btn-accent" href="#/mascotas/nueva">${icon('plus')}Registrar mascota</a></div>
    <div class="filterbar"><div><label class="sr-only" for="sort">Ordenar por</label><select class="pill-select" id="sort">${SORTS.map(([value, label]) => html`<option value="${value}" ${value === filters.sort ? raw('selected') : ''}>${label}</option>`)}</select></div>
      <div class="tabs" role="group" aria-label="Categorías" data-slot="tabs"></div><button class="btn btn-outline" type="button" data-toggle-filters aria-expanded="false" aria-controls="filters">${icon('sliders')}Filtros</button></div>
    <div class="filters-panel" id="filters" hidden data-slot="filters"></div><div class="results" aria-live="polite" data-slot="note"></div><div data-slot="list">${skeletonGrid(8)}</div>
  </div>`);
  const slot = (name, content) => setHtml(view.querySelector(`[data-slot="${name}"]`), content);
  let pets = [];
  const draw = () => {
    const species = uniqueBy(pets.map((pet) => pet.especie));
    const tabs = [['all', 'Todas'], ...species.map((s) => [`especie:${norm(s)}`, s])];
    slot('tabs', html`${tabs.map(([value, label]) => html`<button class="tab" type="button" data-tab="${value}" aria-pressed="${value === filters.tab}">${label}</button>`)}`);
    slot('filters', html`<div class="field"><label for="filter-sexo">Sexo</label><select class="input" id="filter-sexo"><option value="">Todos</option>${uniqueBy(pets.map((pet) => pet.sexo)).map((s) => html`<option ${norm(s) === norm(filters.sexo) ? raw('selected') : ''}>${s}</option>`)}</select></div><label class="check"><input type="checkbox" id="filter-fotos" ${filters.fotos ? raw('checked') : ''}>Solo con imágenes</label><button class="btn btn-soft" type="button" data-clear>Limpiar filtros</button>`);
    const visible = pets.filter((pet) => (!filters.tab.startsWith('especie:') || norm(pet.especie) === filters.tab.slice(8)) && (!filters.sexo || norm(pet.sexo) === norm(filters.sexo)) && (!filters.fotos || pet.img.length) && (!filters.q || norm(`${pet.id} ${pet.especie} ${pet.color} ${pet.sexo}`).includes(norm(filters.q)))).sort(SORTERS[filters.sort]);
    const active = filters.q || filters.sexo || filters.fotos || filters.tab !== 'all';
    slot('note', html`<span>${plural(visible.length, 'mascota', 'mascotas')}${filters.q ? html` para “${filters.q}”` : ''}</span>${active ? html`<button type="button" data-clear>Quitar filtros</button>` : ''}`);
    slot('list', visible.length ? html`<div class="grid">${visible.map(petCard)}</div>` : !pets.length ? stateBlock({ iconName: 'paw', title: 'Todavía no hay mascotas registradas', text: 'Registra la primera y aparecerá en esta galería.', action: html`<a class="btn btn-dark" href="#/mascotas/nueva">Registrar mascota</a>` }) : stateBlock({ iconName: 'search', title: 'Ninguna mascota coincide', text: 'Prueba con otra búsqueda o quita los filtros.', action: html`<button class="btn btn-dark" type="button" data-clear>Quitar filtros</button>` }));
  };
  const update = (changes) => {
    Object.assign(filters, changes);
    const query = new URLSearchParams();
    if (filters.tab !== 'all') query.set('tab', filters.tab);
    if (filters.sort !== 'recent') query.set('sort', filters.sort);
    if (filters.sexo) query.set('sexo', filters.sexo);
    if (filters.fotos) query.set('fotos', '1');
    if (filters.q) query.set('q', filters.q);
    history.replaceState(null, '', `#/mascotas${query.size ? `?${query}` : ''}`);
    topbar.querySelector('#q').value = filters.q;
    draw();
  };
  view.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) return update({ tab: tab.dataset.tab });
    if (event.target.closest('[data-clear]')) return update({ tab: 'all', sexo: '', fotos: false, q: '' });
    const toggle = event.target.closest('[data-toggle-filters]');
    if (toggle) { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); view.querySelector('#filters').hidden = !open; return; }
    const button = event.target.closest('[data-delete-pet]');
    if (button) {
      button.disabled = true;
      const pet = pets.find((item) => item.id === Number(button.dataset.deletePet));
      if (await deleteRecord('pets', pet)) { pets = pets.filter((item) => item.id !== pet.id); draw(); }
      else button.disabled = false;
    }
  });
  view.addEventListener('change', (event) => {
    if (event.target.id === 'sort') update({ sort: event.target.value });
    if (event.target.id === 'filter-sexo') update({ sexo: event.target.value });
    if (event.target.id === 'filter-fotos') update({ fotos: event.target.checked });
  });
  if (filters.sexo || filters.fotos) { view.querySelector('[data-toggle-filters]').setAttribute('aria-expanded', 'true'); view.querySelector('#filters').hidden = false; }
  try { pets = await api('/api/pets'); if (view.isConnected) draw(); }
  catch (error) { slot('list', errorState(error)); }
}

async function viewPetDetail({ id }) {
  const view = mount(html`<div class="page"><div class="detail" data-slot="detail">${loadingBlock()}</div></div>`);
  const box = view.querySelector('[data-slot="detail"]');
  let pet;
  try { pet = await api(`/api/pets/${id}`); }
  catch (error) { return setHtml(box, error.status === 404 ? stateBlock({ iconName: 'search', title: 'Esta mascota no existe', text: 'Puede que se haya eliminado.', action: html`<a class="btn btn-dark" href="#/mascotas">Ver mascotas</a>` }) : errorState(error)); }
  if (!view.isConnected) return;
  const title = petTitle(pet);
  document.title = `${title} · huellas`;
  const images = pet.img.map(imgUrl).filter(Boolean);
  setHtml(box, html`<a class="back" href="#/mascotas">${icon('back')}Volver a mascotas</a>
    <div class="detail-head"><div class="detail-title"><div><p class="eyebrow">Mascota · ID ${pet.id}</p><h1>${title}</h1></div></div><div class="detail-actions"><a class="btn btn-dark" href="#/mascotas/${pet.id}/editar">${icon('edit')}Editar</a><button class="btn btn-ghost-danger" type="button" data-delete>${icon('trash')}Eliminar</button></div></div>
    <div class="viewer">${images.length ? html`<img id="main-image" src="${images[0]}" alt="${title}, imagen 1 de ${images.length}">` : placeholder(pet)}</div>
    ${images.length > 1 ? html`<div class="thumbs" role="group" aria-label="Imágenes">${images.map((src, i) => html`<button type="button" data-thumb="${i}" aria-pressed="${i === 0}" aria-label="Ver imagen ${i + 1} de ${images.length}"><img src="${src}" alt=""></button>`)}</div>` : ''}
    <dl class="facts"><div><dt>Especie</dt><dd>${pet.especie}</dd></div><div><dt>Color</dt><dd>${pet.color}</dd></div><div><dt>Edad</dt><dd>${formatAge(pet.edad)}</dd></div><div><dt>Sexo</dt><dd>${pet.sexo}</dd></div><div><dt>Identificador</dt><dd>${pet.id}</dd></div><div><dt>Imágenes</dt><dd>${pet.img.length}</dd></div></dl>`);
  box.addEventListener('click', async (event) => {
    const thumb = event.target.closest('[data-thumb]');
    if (thumb) {
      const i = Number(thumb.dataset.thumb);
      const main = box.querySelector('#main-image');
      main.src = images[i]; main.alt = `${title}, imagen ${i + 1} de ${images.length}`;
      box.querySelectorAll('[data-thumb]').forEach((button) => button.setAttribute('aria-pressed', String(button === thumb)));
    }
    const button = event.target.closest('[data-delete]');
    if (button) { button.disabled = true; if (await deleteRecord('pets', pet)) go('/mascotas'); else button.disabled = false; }
  });
}

async function viewPetForm({ id }) {
  const editing = Boolean(id);
  const view = mount(html`<div class="page"><div class="form-page" data-slot="form">${loadingBlock()}</div></div>`);
  const box = view.querySelector('[data-slot="form"]');
  let pet = null;
  try { if (editing) pet = await api(`/api/pets/${id}`); }
  catch (error) { return setHtml(box, errorState(error)); }
  if (!view.isConnected) return;
  const back = editing ? `#/mascotas/${pet.id}` : '#/mascotas';
  setHtml(box, html`<a class="back" href="${back}">${icon('back')}Volver a mascotas</a><h1>${editing ? `Editar ${pet.especie}` : 'Registrar mascota'}</h1><p class="muted">${editing ? 'Actualiza sus datos. Si no eliges imágenes nuevas, se conservarán las actuales.' : 'Completa los datos de la mascota. Las imágenes son opcionales.'}</p>
    <form id="pet-form" novalidate><div class="alert alert-error" role="alert" tabindex="-1" hidden></div>
    <section class="form-section" aria-labelledby="images-title"><h2 id="images-title">Imágenes</h2>
      ${pet?.img.length ? html`<div><p class="muted small">Imágenes actuales (${pet.img.length})</p><div class="previews">${pet.img.map((url, i) => html`<figure class="preview"><img src="${imgUrl(url)}" alt="Imagen actual ${i + 1}"></figure>`)}</div></div>` : ''}
      ${pickerTemplate('img-input', MAX_PET_IMAGES, editing ? 'Elige imágenes nuevas para reemplazar las actuales' : 'Arrastra hasta 5 imágenes o haz clic para elegirlas')}
      <div class="alert alert-warn" data-slot="replace-warning" hidden></div>
    </section><section class="form-section" aria-labelledby="data-title"><h2 id="data-title">Datos de la mascota</h2><div class="form-grid">
      ${field('especie', 'Especie *', { value: pet?.especie ?? '', extra: 'required' })}
      ${field('color', 'Color *', { value: pet?.color ?? '', extra: 'required' })}
      ${field('edad', 'Edad en años *', { value: pet ? String(pet.edad) : '', hint: 'Admite cero y decimales, por ejemplo 1.5.', extra: 'inputmode="decimal" required' })}
      ${field('sexo', 'Sexo *', { value: pet?.sexo ?? '', extra: 'list="sex-options" required' })}
    </div><datalist id="sex-options"><option value="macho"></option><option value="hembra"></option></datalist></section>
    <div class="form-actions"><a class="btn btn-outline btn-lg" href="${back}">Cancelar</a><button class="btn btn-accent btn-lg" type="submit">${editing ? 'Guardar cambios' : 'Registrar mascota'}</button></div></form>`);
  const form = box.querySelector('form');
  const warning = box.querySelector('[data-slot="replace-warning"]');
  const picker = imagePicker(form.querySelector('[data-picker]'), MAX_PET_IMAGES, (files) => {
    warning.hidden = !(editing && pet.img.length && files.length);
    warning.textContent = 'Al guardar, las imágenes nuevas reemplazarán todas las actuales.';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(['especie', 'color', 'edad', 'sexo'].map((name) => [name, form.elements[name].value.trim()]));
    values.edad = values.edad.replace(',', '.');
    const errors = {};
    for (const name of ['especie', 'color', 'sexo']) if (!values[name]) errors[name] = `Completa el campo ${name}`;
    if (!/^\d+(\.\d+)?$/.test(values.edad) || !Number.isFinite(Number(values.edad))) errors.edad = 'La edad debe ser un número mayor o igual a cero';
    if (!showErrors(form, errors) || !picker.valid) return;
    const changes = Object.fromEntries(Object.entries(values).filter(([name, value]) => !editing || (name === 'edad' ? Number(value) !== pet.edad : value !== pet[name])));
    if (!Object.keys(changes).length && !picker.files.length) return toast('No hay cambios para guardar');
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    if (editing && pet.img.length && picker.files.length && !await confirmDialog({ title: '¿Reemplazar las imágenes?', message: 'Las imágenes actuales se eliminarán después de guardar las nuevas.', confirmText: 'Reemplazar', danger: false })) return;
    await submitting(button, 'Guardando…', async () => {
      const data = new FormData();
      for (const [name, value] of Object.entries(changes)) data.append(name, value);
      picker.files.forEach((file) => data.append('img', file, file.name));
      const saved = await api(editing ? `/api/pets/${pet.id}` : '/api/pets', { method: editing ? 'PUT' : 'POST', body: data });
      toast(editing ? 'Cambios guardados' : 'Mascota registrada');
      if (form.isConnected) go(`/mascotas/${saved.id}`);
    }, form.querySelector('.alert'));
  });
}

async function viewUsers({ params }) {
  const q = params.get('q') ?? '';
  const view = mount(html`<div class="page"><div class="page-head"><div><p class="eyebrow">Directorio</p><h1>Usuarios</h1><p class="muted">Consulta sus datos, actualiza sus avatares y administra los registros.</p></div><a class="btn btn-accent" href="#/usuarios/nuevo">${icon('plus')}Registrar usuario</a></div><div class="results" aria-live="polite" data-slot="note"></div><div data-slot="list">${loadingBlock('Cargando usuarios…')}</div></div>`);
  const list = view.querySelector('[data-slot="list"]');
  let users;
  const draw = () => {
    const visible = users.filter((user) => norm(`${user.id} ${user.firstname} ${user.lastname} ${user.username}`).includes(norm(q))).sort((a, b) => b.id - a.id);
    setHtml(view.querySelector('[data-slot="note"]'), html`${plural(visible.length, 'usuario', 'usuarios')}${q ? html` para “${q}” · <a class="link" href="#/usuarios">Quitar búsqueda</a>` : ''}`);
    setHtml(list, visible.length ? html`<div class="table-wrap"><table class="table"><caption class="sr-only">Usuarios registrados</caption><thead><tr><th>Usuario</th><th>Nombre completo</th><th>Identificador</th><th class="num">Acciones</th></tr></thead><tbody>${visible.map((user) => html`<tr><td data-label="Usuario"><a class="user-row" href="#/usuarios/${user.id}">${avatar(user, 40)}<strong>@${user.username}</strong></a></td><td data-label="Nombre completo">${user.firstname} ${user.lastname}</td><td data-label="Identificador">${user.id}</td><td class="row-actions"><a class="btn btn-soft btn-sm" href="#/usuarios/${user.id}" aria-label="Ver ${user.username}">Ver</a><a class="round-btn" href="#/usuarios/${user.id}/editar" aria-label="Editar ${user.username}">${icon('edit')}</a><button class="round-btn" type="button" data-delete-user="${user.id}" aria-label="Eliminar ${user.username}">${icon('trash')}</button></td></tr>`)}</tbody></table></div>` : stateBlock({ iconName: q ? 'search' : 'user', title: q ? 'Ningún usuario coincide' : 'Todavía no hay usuarios registrados', text: q ? 'Prueba con otro nombre o quita la búsqueda.' : 'Agrega el primer usuario para comenzar.', action: q ? html`<a class="btn btn-dark" href="#/usuarios">Ver todos</a>` : html`<a class="btn btn-dark" href="#/usuarios/nuevo">Registrar usuario</a>` }));
  };
  view.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-user]');
    if (!button) return;
    button.disabled = true;
    const user = users.find((item) => item.id === Number(button.dataset.deleteUser));
    if (await deleteRecord('users', user)) { users = users.filter((item) => item.id !== user.id); draw(); }
    else button.disabled = false;
  });
  try { users = await api('/api/users'); if (view.isConnected) draw(); }
  catch (error) { setHtml(list, errorState(error)); }
}

async function viewUserDetail({ id }) {
  const view = mount(html`<div class="page" data-slot="user">${loadingBlock()}</div>`);
  const box = view.querySelector('[data-slot="user"]');
  let user;
  try { user = await api(`/api/users/${id}`); }
  catch (error) { return setHtml(box, error.status === 404 ? stateBlock({ iconName: 'user', title: 'Este usuario no existe', text: 'Puede que se haya eliminado.', action: html`<a class="btn btn-dark" href="#/usuarios">Ver usuarios</a>` }) : errorState(error)); }
  if (!view.isConnected) return;
  setHtml(box, html`<a class="back" href="#/usuarios">${icon('back')}Volver a usuarios</a><div class="profile"><aside class="profile-card">${avatar(user, 96)}<h1>${user.firstname} ${user.lastname}</h1><p class="muted">@${user.username} · ID ${user.id}</p><a class="btn btn-dark" href="#/usuarios/${user.id}/editar">${icon('edit')}Editar usuario</a></aside><section class="card" aria-labelledby="user-details"><h2 id="user-details">Datos del usuario</h2><dl class="facts user-facts"><div><dt>Nombre</dt><dd>${user.firstname}</dd></div><div><dt>Apellido</dt><dd>${user.lastname}</dd></div><div><dt>Nombre de usuario</dt><dd>${user.username}</dd></div><div><dt>Identificador</dt><dd>${user.id}</dd></div></dl><p class="muted small">Puedes actualizar sus datos, cambiar su avatar o establecer una contraseña nueva desde la edición.</p><div class="form-actions"><button class="btn btn-ghost-danger" type="button" data-delete>${icon('trash')}Eliminar usuario</button></div></section></div>`);
  box.querySelector('[data-delete]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    if (await deleteRecord('users', user)) go('/usuarios'); else button.disabled = false;
  });
}

async function viewUserForm({ id }) {
  const editing = Boolean(id);
  const view = mount(html`<div class="page"><div class="form-page" data-slot="form">${loadingBlock()}</div></div>`);
  const box = view.querySelector('[data-slot="form"]');
  let user = null;
  try { if (editing) user = await api(`/api/users/${id}`); }
  catch (error) { return setHtml(box, errorState(error)); }
  if (!view.isConnected) return;
  const back = editing ? `#/usuarios/${id}` : '#/usuarios';
  setHtml(box, html`<a class="back" href="${back}">${icon('back')}Volver a usuarios</a><h1>${editing ? 'Editar usuario' : 'Registrar usuario'}</h1><p class="muted">${editing ? 'Actualiza solo lo que necesites. El avatar y la contraseña se conservan si no los cambias.' : 'Completa sus datos. El avatar es opcional.'}</p><form id="user-form" novalidate><div class="alert alert-error" role="alert" tabindex="-1" hidden></div>
    <section class="form-section" aria-labelledby="user-data"><h2 id="user-data">Datos del usuario</h2><div class="form-grid">
    ${field('firstname', 'Nombre *', { value: user?.firstname ?? '', autocomplete: 'given-name', extra: 'required' })}
    ${field('lastname', 'Apellido *', { value: user?.lastname ?? '', autocomplete: 'family-name', extra: 'required' })}
    ${field('username', 'Nombre de usuario *', { value: user?.username ?? '', full: true, autocomplete: 'username', hint: 'Debe ser único.', extra: 'required' })}
    ${field('password', editing ? 'Contraseña nueva' : 'Contraseña *', { type: 'password', autocomplete: 'new-password', hint: editing ? 'Deja este campo vacío para conservar la actual.' : '', extra: editing ? '' : 'required' })}
    ${field('confirmPassword', editing ? 'Confirmar contraseña nueva' : 'Confirmar contraseña *', { type: 'password', autocomplete: 'new-password', extra: editing ? '' : 'required' })}
    </div></section><section class="form-section" aria-labelledby="avatar-title"><h2 id="avatar-title">Avatar</h2>${user?.avatar ? html`<div class="current-avatar">${avatar(user, 64)}<span class="muted">Avatar actual. Se conservará si no eliges otro.</span></div>` : ''}${pickerTemplate('avatar-input', 1, editing ? 'Elige un avatar nuevo para reemplazar el actual' : 'Arrastra una imagen o haz clic para elegirla')}</section>
    <div class="form-actions"><a class="btn btn-outline btn-lg" href="${back}">Cancelar</a><button class="btn btn-accent btn-lg" type="submit">${editing ? 'Guardar cambios' : 'Registrar usuario'}</button></div></form>`);
  const form = box.querySelector('form');
  const picker = imagePicker(form.querySelector('[data-picker]'), 1);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(['firstname', 'lastname', 'username'].map((name) => [name, form.elements[name].value.trim()]));
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmPassword.value;
    const errors = {};
    for (const [name, value] of Object.entries(values)) if (!value) errors[name] = 'Completa este campo';
    if ((!editing || password) && !password.trim()) errors.password = 'Escribe una contraseña';
    if ((!editing || password || confirmation) && confirmation !== password) errors.confirmPassword = 'Las contraseñas no coinciden';
    if (!showErrors(form, errors) || !picker.valid) return;
    const changes = Object.fromEntries(Object.entries(values).filter(([name, value]) => !editing || value !== user[name]));
    if (!editing || password) changes.password = password;
    if (!Object.keys(changes).length && !picker.files.length) return toast('No hay cambios para guardar');
    await submitting(form.querySelector('[type="submit"]'), 'Guardando…', async () => {
      const data = new FormData();
      for (const [name, value] of Object.entries(changes)) data.append(name, value);
      if (picker.files.length) data.append('avatar', picker.files[0], picker.files[0].name);
      const saved = await api(editing ? `/api/users/${id}` : '/api/users', { method: editing ? 'PUT' : 'POST', body: data });
      form.elements.password.value = ''; form.elements.confirmPassword.value = '';
      toast(editing ? 'Usuario actualizado' : 'Usuario registrado');
      if (form.isConnected) go(`/usuarios/${saved.id}`);
    }, form.querySelector('.alert'));
  });
}

const ROUTES = [
  [/^\/$/, viewDashboard, 'Inicio'],
  [/^\/mascotas$/, viewPets, 'Mascotas'],
  [/^\/mascotas\/nueva$/, viewPetForm, 'Registrar mascota'],
  [/^\/mascotas\/(\d+)$/, viewPetDetail, 'Mascota'],
  [/^\/mascotas\/(\d+)\/editar$/, viewPetForm, 'Editar mascota'],
  [/^\/usuarios$/, viewUsers, 'Usuarios'],
  [/^\/usuarios\/nuevo$/, viewUserForm, 'Registrar usuario'],
  [/^\/usuarios\/(\d+)$/, viewUserDetail, 'Usuario'],
  [/^\/usuarios\/(\d+)\/editar$/, viewUserForm, 'Editar usuario'],
];
async function render() {
  const { path, params } = parseHash();
  renderHeader(path, params);
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return mount(html`<div class="page">${stateBlock({ iconName: 'search', title: 'No encontramos esta página', text: 'Puedes continuar desde el inicio o consultar los registros.', action: html`<a class="btn btn-dark" href="#/">Ir al inicio</a>` })}</div>`);
  const [pattern, view, title] = route;
  document.title = `${title} · huellas`;
  window.scrollTo(0, 0);
  await view({ id: Number(pattern.exec(path)[1]) || null, params });
  if (!app.contains(document.activeElement) && !topbar.contains(document.activeElement)) app.focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);
render();
