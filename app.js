// Configuração do Supabase Client
const SUPABASE_URL = "https://ggxlztpttlaudkiqsuqb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdneGx6dHB0dGxhdWRraXFzdXFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDMzMDgsImV4cCI6MjA5ODA3OTMwOH0.W72Aa_XEuiHfjvFA0tV3T6Vy7juXS1yoJ-VXBBJeDs0";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Paginação e Estado Global
let currentPage = 1;
const pageSize = 50;
let totalRecords = 0;
let currentFilters = {};

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
  const bairro = document.getElementById('filter-bairro').value.trim();

  // Guardar filtros atuais para paginação
  currentFilters = { municipio, logradouro, bairro };
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
    
    // Início da query na view comgas_distinct (resultados únicos)
    let query = supabaseClient
      .from('comgas_distinct')
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
  data.forEach(row => {
    const tr = document.createElement('tr');
    
    // Etiqueta formatada (nome oficial completo)
    const etiqText = row.ETIQ_AC || row.ETIQ || row.NOME || 'Não informado';
    const etiqRaw  = row.ETIQ   || row.NOME || '';

    // Bairro
    const bairro = (row.BAIRRO && row.BAIRRO.trim()) ? row.BAIRRO.trim() : '—';

    // Distrito
    const distrito = (row.DISTRITO && row.DISTRITO.trim()) ? row.DISTRITO.trim() : '—';

    // Município
    const municipio = row.MUNICIPIO || 'Não informado';

    tr.innerHTML = `
      <td><strong>${etiqText}</strong><br><small class="text-muted">${etiqRaw}</small></td>
      <td>${bairro}</td>
      <td>${distrito}</td>
      <td>${municipio}</td>
      <td>
        <span class="status-badge available">
          <i class="fa-solid fa-circle-check"></i> Existente
        </span>
      </td>
    `;
    resultsTbody.appendChild(tr);
  });

  resultsTableWrapper.style.display = 'block';
  updatePaginationControls();
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
  const noResultsText = noResults.querySelector('p');
  
  noResultsTitle.textContent = "Erro na Consulta";
  noResultsText.textContent = "Houve um problema de conexão com o banco de dados do Supabase. Por favor, tente novamente mais tarde.";
}
