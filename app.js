// Configuração do Supabase Client (via variáveis de ambiente Vite)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Paginação e Estado Global
let currentPage = 1;
const pageSize = 50;
let totalRecords = 0;
let currentFilters = {};
let pageTrechosCache = {};

// Elementos do DOM
const searchForm = document.getElementById('search-form');
const btnClear = document.getElementById('btn-clear');
const resultsContainer = document.getElementById('results-container');
const loadingSpinner = document.getElementById('loading-spinner');
const noResults = document.getElementById('no-results');
const resultsTableWrapper = document.getElementById('results-table-wrapper');
const resultsTbody = document.getElementById('results-tbody');
const resultsCount = document.getElementById('results-count');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const paginationInfo = document.getElementById('pagination-info');


// Inicialização da Página
document.addEventListener('DOMContentLoaded', () => {
  // Limpar os filtros ao carregar
  searchForm.reset();
});

// Event Listeners
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Pegar valores dos campos
  const municipio = document.getElementById('filter-municipio').value;
  const logradouro = document.getElementById('filter-logradouro').value.trim();

  // Guardar filtros atuais para paginação
  currentFilters = { municipio, logradouro };
  currentPage = 1;

  // Executar a busca
  await executeSearch();
});

btnClear.addEventListener('click', () => {
  searchForm.reset();
  resultsContainer.style.display = 'none';
});

btnPrev.addEventListener('click', async () => {
  if (currentPage > 1) {
    currentPage--;
    await executeSearch(true); // true indica que estamos paginando, não reinicia scroll/carregamento total
  }
});

btnNext.addEventListener('click', async () => {
  const totalPages = Math.ceil(totalRecords / pageSize);
  if (currentPage < totalPages) {
    currentPage++;
    await executeSearch(true);
  }
});

// Função principal de busca
async function executeSearch(isPaging = false) {
  showLoading();

  try {
    const { municipio, cep, logradouro, bairro } = currentFilters;
    
    // Início da query na view de logradouros únicos
    let query = supabaseClient
      .from('redegas_distinct')
      .select('NOME,ETIQ,ETIQ_AC,BAIRRO,DISTRITO,MUNICIPIO', { count: 'exact' });

    // Aplicar filtros dinamicamente
    if (municipio && municipio !== 'ALL') {
      query = query.eq('MUNICIPIO', municipio);
    }

    if (logradouro) {
      // Divide a busca por espaços e filtra cada termo no campo NOME
      const terms = logradouro.trim().split(/\s+/).filter(Boolean);
      terms.forEach(term => {
        query = query.ilike('NOME', `%${term}%`);
      });
    }

    if (bairro) {
      // Busca parcial por Bairro ou Distrito
      query = query.or(`BAIRRO.ilike.%${bairro}%,DISTRITO.ilike.%${bairro}%`);
    }

    // Intervalo de paginação (0-indexed no range do Supabase)
    const fromIndex = (currentPage - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    query = query.range(fromIndex, toIndex);
    
    // Ordenação por nome do logradouro
    query = query.order('NOME', { ascending: true });

    // Executar a query
    const { data, count, error } = await query;

    if (error) {
      console.error("Erro ao buscar dados:", error);
      showErrorState();
      return;
    }

    totalRecords = count || 0;

    // Buscar trechos para todos os logradouros retornados nesta página para calcular os trechos únicos e exibir no subtítulo
    pageTrechosCache = {};
    if (data && data.length > 0) {
      try {
        const nomes = [...new Set(data.map(item => item.NOME))];
        const municipios = [...new Set(data.map(item => item.MUNICIPIO))];
        
        const { data: trechosData, error: trechosError } = await supabaseClient
          .from('redegas')
          .select('NOME,MUNICIPIO,ID_COMGAS,DATA_COMGA,ID,INI_E,FIN_E,INI_D,FIN_D,CEP_E,CEP_D')
          .in('NOME', nomes)
          .in('MUNICIPIO', municipios);

        if (!trechosError && trechosData) {
          trechosData.forEach(t => {
            const key = `${t.NOME}|${t.MUNICIPIO}`;
            if (!pageTrechosCache[key]) {
              pageTrechosCache[key] = [];
            }
            pageTrechosCache[key].push(t);
          });
        }
      } catch (e) {
        console.error("Erro ao pré-carregar trechos:", e);
      }
    }

    renderResults(data);

    // Rolar suavemente para os resultados se for uma nova busca
    if (!isPaging) {
      resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

  } catch (err) {
    console.error("Erro inesperado:", err);
    showErrorState();
  }
}

// Controladores de Estado de Exibição
function showLoading() {
  resultsContainer.style.display = 'block';
  loadingSpinner.style.display = 'flex';
  noResults.style.display = 'none';
  resultsTableWrapper.style.display = 'none';
  paginationInfo.textContent = '';
  btnPrev.disabled = true;
  btnNext.disabled = true;
}

function renderResults(data) {
  loadingSpinner.style.display = 'none';
  
  if (!data || data.length === 0) {
    noResults.style.display = 'flex';
    resultsTableWrapper.style.display = 'none';
    resultsCount.textContent = '0 resultados encontrados';
    return;
  }

  // Preencher contagem de resultados
  resultsCount.textContent = `${totalRecords.toLocaleString('pt-BR')} logradouro(s) encontrado(s)`;
  
  // Limpar a tabela
  resultsTbody.innerHTML = '';

  // Renderizar linhas da tabela
  data.forEach((row, idx) => {
    const rowId = `row-${currentPage}-${idx}`;

    // Etiqueta formatada
    const etiqText = row.ETIQ_AC || row.ETIQ || row.NOME || 'Não informado';
    
    // Obter trechos pré-carregados para esta rua
    const cacheKey = `${row.NOME}|${row.MUNICIPIO}`;
    const trechosList = pageTrechosCache[cacheKey] || [];
    
    // Calcular a quantidade de trechos únicos (usando a mesma lógica do distinct)
    const seen = new Set();
    let uniqueCount = 0;
    trechosList.forEach(t => {
      const iniE = parseInt(t.INI_E) || 0;
      const iniD = parseInt(t.INI_D) || 0;
      const nonZeroInis = [iniE, iniD].filter(v => v > 0);
      const numInicio = nonZeroInis.length ? Math.min(...nonZeroInis) : null;

      const finE = parseInt(t.FIN_E) || 0;
      const finD = parseInt(t.FIN_D) || 0;
      const nonZeroFins = [finE, finD].filter(v => v > 0);
      const numFinal = nonZeroFins.length ? Math.max(...nonZeroFins) : '—';

      const cepE = (t.CEP_E || '').trim().replace(/\D/g, '');
      const cepD = (t.CEP_D || '').trim().replace(/\D/g, '');
      let cep;
      if (cepE && cepD && cepE !== '0' && cepD !== '0' && cepE.length > 1 && cepD.length > 1) {
        cep = cepE === cepD ? formatCep(cepE) : `${formatCep(cepE)} / ${formatCep(cepD)}`;
      } else {
        const valid = [cepE, cepD].find(c => c && c !== '0' && c.length > 1);
        cep = valid ? formatCep(valid) : '—';
      }

      const idVal = t.ID || '—';

      const rowKey = `${numInicio !== null ? numInicio : '—'}|${numFinal}|${cep}|${idVal}`;
      if (!seen.has(rowKey)) {
        seen.add(rowKey);
        uniqueCount++;
      }
    });

    const subTitleText = `${uniqueCount} trecho(s) único(s) cadastrado(s)`;
    const bairro   = (row.BAIRRO   && row.BAIRRO.trim())   ? row.BAIRRO.trim()   : '—';
    const distrito = (row.DISTRITO && row.DISTRITO.trim()) ? row.DISTRITO.trim() : '—';

    // Linha principal com botão de expansão
    const tr = document.createElement('tr');
    tr.className = 'main-row';
    tr.innerHTML = `
      <td class="expand-cell">
        <button class="expand-btn" id="expand-${rowId}" aria-expanded="false" aria-label="Expandir trechos">
          <i class="fa-solid fa-chevron-right expand-icon"></i>
        </button>
      </td>
      <td><strong>${etiqText}</strong><br><small class="text-muted">${subTitleText}</small></td>
      <td>${bairro}</td>
      <td>${distrito}</td>
    `;

    // Sub-linha oculta para os trechos
    const subTr = document.createElement('tr');
    subTr.className = 'sub-row';
    subTr.id = `sub-${rowId}`;
    subTr.style.display = 'none';
    subTr.innerHTML = `<td colspan="4"><div class="trechos-container" id="trechos-${rowId}"></div></td>`;

    resultsTbody.appendChild(tr);
    resultsTbody.appendChild(subTr);

    // Handler do botão de expansão
    tr.querySelector('.expand-btn').addEventListener('click', () => {
      toggleTrechos(rowId, row.NOME, row.MUNICIPIO);
    });
  });

  resultsTableWrapper.style.display = 'block';
  updatePaginationControls();
}

// Alterna a visibilidade dos subitens de um logradouro
async function toggleTrechos(rowId, nome, municipio) {
  const subTr     = document.getElementById(`sub-${rowId}`);
  const expandBtn = document.getElementById(`expand-${rowId}`);
  const container = document.getElementById(`trechos-${rowId}`);

  const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';

  if (isExpanded) {
    expandBtn.setAttribute('aria-expanded', 'false');
    subTr.style.display = 'none';
    return;
  }

  expandBtn.setAttribute('aria-expanded', 'true');
  subTr.style.display = '';

  // Já carregado anteriormente — apenas mostrar
  if (container.dataset.loaded === 'true') return;

  // Estado de carregamento
  container.innerHTML = `
    <div class="trechos-loading">
      <div class="spinner-sm"></div>
      <span>Carregando trechos...</span>
    </div>`;

  // Tenta carregar do cache antes de fazer fetch
  const cacheKey = `${nome}|${municipio}`;
  let trechos = pageTrechosCache[cacheKey];

  if (!trechos) {
    trechos = await fetchTrechos(nome, municipio);
  }
  
  renderTrechos(trechos, container);
  container.dataset.loaded = 'true';
}

// Busca os trechos da tabela principal de rede
async function fetchTrechos(nome, municipio) {
  try {
    let query = supabaseClient
      .from('redegas')
      .select('ID_COMGAS,DATA_COMGA,ID,INI_E,FIN_E,INI_D,FIN_D,CEP_E,CEP_D')
      .eq('NOME', nome);

    if (municipio) {
      query = query.eq('MUNICIPIO', municipio);
    }

    query = query.order('INI_E', { ascending: true });

    const { data, error } = await query;
    if (error) { console.error('Erro ao buscar trechos:', error); return null; }
    return data;
  } catch (e) {
    console.error('Erro inesperado (trechos):', e);
    return null;
  }
}

// Renderiza os cartões de trecho dentro do container da sub-linha
function renderTrechos(trechos, container) {
  if (!trechos || trechos.length === 0) {
    container.innerHTML = `
      <p class="trechos-empty">
        <i class="fa-solid fa-circle-info"></i> Nenhum trecho encontrado para este logradouro.
      </p>`;
    return;
  }

  // Pré-calcula o menor número de início para ordenar de forma correta (numérica)
  const mappedTrechos = trechos.map(t => {
    const iniE = parseInt(t.INI_E) || 0;
    const iniD = parseInt(t.INI_D) || 0;
    const nonZeroInis = [iniE, iniD].filter(v => v > 0);
    const numInicio = nonZeroInis.length ? Math.min(...nonZeroInis) : null;
    return { ...t, _numInicio: numInicio };
  });

  // Ordena os trechos pelo menor número de início de forma crescente (nulos por último)
  mappedTrechos.sort((a, b) => {
    if (a._numInicio === null) return 1;
    if (b._numInicio === null) return -1;
    return a._numInicio - b._numInicio;
  });

  const uniqueRows = [];
  const seen = new Set();

  mappedTrechos.forEach(t => {
    const numInicio = t._numInicio !== null ? t._numInicio : '—';

    // Número final: maior valor não-zero entre FIN_E e FIN_D
    const finE = parseInt(t.FIN_E) || 0;
    const finD = parseInt(t.FIN_D) || 0;
    const nonZeroFins = [finE, finD].filter(v => v > 0);
    const numFinal = nonZeroFins.length ? Math.max(...nonZeroFins) : '—';

    // CEP: mostrar apenas um se forem iguais
    const cepE = (t.CEP_E || '').trim().replace(/\D/g, '');
    const cepD = (t.CEP_D || '').trim().replace(/\D/g, '');
    let cep;
    if (cepE && cepD && cepE !== '0' && cepD !== '0' && cepE.length > 1 && cepD.length > 1) {
      cep = cepE === cepD
        ? formatCep(cepE)
        : `${formatCep(cepE)} / ${formatCep(cepD)}`;
    } else {
      const valid = [cepE, cepD].find(c => c && c !== '0' && c.length > 1);
      cep = valid ? formatCep(valid) : '—';
    }

    const idVal = t.ID || '—';
    
    let numeracao = '—';
    if (numInicio !== '—' || numFinal !== '—') {
      numeracao = `de ${numInicio} até ${numFinal}`;
    }

    // Chave de identificação única para evitar registros visualmente idênticos
    const rowKey = `${numInicio}|${numFinal}|${cep}|${idVal}`;
    if (!seen.has(rowKey)) {
      seen.add(rowKey);
      uniqueRows.push(`
      <tr class="trecho-row">
        <td>${numeracao}</td>
        <td>${cep}</td>
        <td>${idVal}</td>
      </tr>`);
    }
  });

  const rows = uniqueRows.join('');

  container.innerHTML = `
    <div class="trechos-header-label">
      <i class="fa-solid fa-route"></i>
      <strong>${uniqueRows.length}</strong> trecho(s) único(s) cadastrado(s)
    </div>
    <div class="trechos-table-wrapper">
      <table class="trechos-table">
        <thead>
          <tr>
            <th><i class="fa-solid fa-hashtag"></i> Numeração</th>
            <th><i class="fa-solid fa-envelope"></i> CEP</th>
            <th><i class="fa-solid fa-fingerprint"></i> ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Formata CEP: 00000-000
function formatCep(digits) {
  if (!digits || digits === '0' || digits.length === 0) return '—';
  const d = digits.replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return digits;
}

// Formata data ISO para DD/MM/AAAA
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : dateStr;
}

function updatePaginationControls() {
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  paginationInfo.textContent = `Página ${currentPage} de ${totalPages}`;
  
  btnPrev.disabled = currentPage === 1;
  btnNext.disabled = currentPage === totalPages;
}

function showErrorState() {
  loadingSpinner.style.display = 'none';
  resultsTableWrapper.style.display = 'none';
  noResults.style.display = 'flex';
  
  const noResultsTitle = noResults.querySelector('h4');
  const noResultsText  = noResults.querySelector('p');
  
  noResultsTitle.textContent = "Erro na Consulta";
  noResultsText.textContent  = "Houve um problema de conexão com o banco de dados do Supabase. Por favor, tente novamente mais tarde.";
}
