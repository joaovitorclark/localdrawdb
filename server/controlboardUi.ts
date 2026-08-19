// UI estática do controlboard — HTML+JS puro, sem build/Vite. Servida como
// texto simples por server/controlboard.ts. Ferramenta de dev, não faz
// parte do bundle do app (App.tsx/AppGate/DomainPicker não mudam).
export const CONTROLBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>LocalDrawDB — Controlboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  .domain { border: 1px solid #8883; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
  .domain__head { display: flex; align-items: center; gap: 0.5rem; }
  .badge { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: #8883; }
  .badge--git { background: #2a72; }
  .project { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; }
  .instance { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; }
  .error { color: #c33; margin: 0.5rem 0; min-height: 1.2em; }
  form { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
  input { flex: 1; }
</style>
</head>
<body>
<h1>LocalDrawDB — Controlboard</h1>
<div id="error" class="error"></div>

<section>
  <h2>Domínios</h2>
  <div id="domains"></div>
  <form id="new-local-form">
    <input id="new-local-name" placeholder="Nome do domínio local" />
    <button type="submit">+ Novo domínio local</button>
  </form>
  <form id="clone-form">
    <input id="clone-name" placeholder="Nome (opcional)" />
    <input id="clone-url" placeholder="URL do repositório git" />
    <button type="submit">+ Clonar repositório</button>
  </form>
</section>

<section>
  <h2>Instâncias rodando</h2>
  <div id="instances">Nenhuma.</div>
</section>

<script>
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(msg) {
  document.getElementById('error').textContent = msg || '';
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Falha: ' + res.status));
  return data;
}

async function refreshDomains() {
  showError('');
  try {
    const { domains } = await api('GET', '/api/board/domains');
    renderDomains(domains);
  } catch (e) {
    showError(e.message);
  }
}

function renderDomains(domains) {
  const root = document.getElementById('domains');
  root.innerHTML = '';
  for (const d of domains) {
    const el = document.createElement('div');
    el.className = 'domain';
    const badgeClass = d.hasGit ? 'badge badge--git' : 'badge';
    const badgeText = d.hasGit ? 'Git' : 'Local';
    el.innerHTML =
      '<div class="domain__head">' +
        '<span class="' + badgeClass + '">' + badgeText + '</span>' +
        '<strong>' + escapeHtml(d.name) + '</strong>' +
        '<button data-delete-domain="' + d.id + '" style="margin-left:auto">Apagar domínio</button>' +
      '</div>' +
      '<div class="projects"></div>' +
      '<form class="new-project-form" data-domain="' + d.id + '">' +
        '<input placeholder="Nome do novo projeto" required />' +
        '<button type="submit">+ Novo projeto</button>' +
      '</form>';
    const projectsEl = el.querySelector('.projects');
    for (const p of d.projects) {
      const row = document.createElement('div');
      row.className = 'project';
      row.innerHTML =
        '<span>' + escapeHtml(p.name) + '</span>' +
        '<button data-open="' + d.id + '" data-project="' + p.id + '">Abrir</button>';
      projectsEl.appendChild(row);
    }
    root.appendChild(el);
  }
}

async function refreshInstances() {
  try {
    const { instances } = await api('GET', '/api/board/instances');
    renderInstances(instances);
  } catch (e) {
    showError(e.message);
  }
}

function renderInstances(instances) {
  const root = document.getElementById('instances');
  if (instances.length === 0) {
    root.textContent = 'Nenhuma.';
    return;
  }
  root.innerHTML = '';
  for (const i of instances) {
    const row = document.createElement('div');
    row.className = 'instance';
    row.innerHTML =
      '<a href="' + i.url + '" target="_blank">' + escapeHtml(i.domainName) + ' / ' + escapeHtml(i.projectName) + ' — ' + i.url + '</a>' +
      '<button data-stop="' + i.id + '">Parar</button>';
    root.appendChild(row);
  }
}

document.getElementById('domains').addEventListener('click', async (e) => {
  const target = e.target;
  if (target.dataset.open) {
    showError('');
    try {
      await api('POST', '/api/board/instances', { domainId: target.dataset.open, projectId: target.dataset.project });
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  } else if (target.dataset.deleteDomain) {
    showError('');
    try {
      await api('DELETE', '/api/board/domains/' + target.dataset.deleteDomain);
      await refreshDomains();
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  }
});

document.getElementById('domains').addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('new-project-form')) return;
  e.preventDefault();
  const domainId = e.target.dataset.domain;
  const input = e.target.querySelector('input');
  showError('');
  try {
    await api('POST', '/api/board/projects', { domainId, name: input.value.trim() });
    input.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('new-local-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-local-name');
  showError('');
  try {
    await api('POST', '/api/board/domains', { name: input.value.trim() });
    input.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('clone-name');
  const urlInput = document.getElementById('clone-url');
  showError('');
  try {
    await api('POST', '/api/board/domains/clone', { url: urlInput.value.trim(), name: nameInput.value.trim() || undefined });
    nameInput.value = '';
    urlInput.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('instances').addEventListener('click', async (e) => {
  const target = e.target;
  if (target.dataset.stop) {
    showError('');
    try {
      await api('DELETE', '/api/board/instances/' + target.dataset.stop);
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  }
});

refreshDomains();
refreshInstances();
setInterval(refreshInstances, 2000);
</script>
</body>
</html>
`;
