"""
Scraper de consulta de pedidos na Intranet Lider (http://192.168.0.6/).

Fluxo autenticado via httpx.Client:
1. GET http://192.168.0.6/ -> captura cookie de sessão (PHPSESSID)
2. POST http://192.168.0.6/home/login/ -> autentica com usuário e senha fornecidos
3. POST http://192.168.0.6/pcp/situacao_pedidos2.php -> obtém saldo/quantidade por (pedido, cod_item)
4. GET http://192.168.0.6/JSN001/json-pedido-estrutura.php?pedido=... -> obtém árvore de estrutura
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional, Sequence, Tuple

from bs4 import BeautifulSoup
import httpx

INTRANET_BASE = "http://192.168.0.6"
HOME_URL = f"{INTRANET_BASE}/"
LOGIN_URL = f"{INTRANET_BASE}/home/login/"
SITUACAO_PEDIDOS_URL = f"{INTRANET_BASE}/pcp/situacao_pedidos2.php"
ESTRUTURA_PEDIDO_URL = f"{INTRANET_BASE}/JSN001/json-pedido-estrutura.php"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}


def extrair_empresa_e_pedido(valor: Any) -> Tuple[str, str]:
    """
    Separa prefixo de empresa e número do pedido em strings como '(11)-209082' -> ('11', '209082')
    ou '209082' -> ('', '209082').
    """
    texto = str(valor or "").strip()
    if not texto:
        return "", ""

    m_emp = re.match(r"^\(\s*(\d+)\s*\)\s*-\s*(.+)$", texto)
    empresa = ""
    corpo_ped = texto
    if m_emp:
        empresa = str(int(m_emp.group(1)))
        corpo_ped = m_emp.group(2).strip()

    apenas_digitos = re.sub(r"[^\d]", "", corpo_ped)
    if apenas_digitos and apenas_digitos == corpo_ped:
        return empresa, str(int(apenas_digitos))
    return empresa, corpo_ped


def normalizar_numero_pedido(valor: Any) -> str:
    """Normaliza número do pedido removendo prefixo '(empresa)-', espaços e zeros à esquerda."""
    _, ped = extrair_empresa_e_pedido(valor)
    return ped


def normalizar_cod_item(valor: Any) -> str:
    """Normaliza código do item removendo sufixos de unidade (-UN, -M2, etc.) e espaços."""
    texto = str(valor or "").strip()
    if not texto:
        return ""
    return texto.split("-")[0].strip().upper()


def parse_numero_flexivel(valor: Any, default: float = 0.0) -> float:
    """
    Converte strings numéricas tanto no padrão brasileiro ('Qtd. 1,000', '1.234,56', '2,000')
    quanto no padrão ISO/JSON ('1.8100000', '2.5') para float.
    """
    if valor is None:
        return default
    if isinstance(valor, (int, float)):
        return float(valor)

    texto = str(valor).strip()
    if not texto or texto == ".":
        return default

    m_num = re.search(r"-?\d[\d.,]*", texto)
    if not m_num:
        return default
    token = m_num.group(0)

    if "," in token and "." in token:
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif "," in token:
        token = token.replace(",", ".")

    try:
        return float(token)
    except ValueError:
        return default


def _decodificar_html(resp: httpx.Response) -> str:
    """Decodifica bytes HTML tratando UTF-8 e ISO-8859-1/Windows-1252 da intranet."""
    raw = resp.content
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def _norm_header(texto: str) -> str:
    """Remove acentos e pontuação de cabeçalhos de tabela HTML para matching seguro."""
    sem_acento = (
        unicodedata.normalize("NFKD", str(texto or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    limpo = re.sub(r"[^a-zA-Z0-9]+", " ", sem_acento).strip().lower()
    return re.sub(r"\s+", " ", limpo)


def _foi_redirecionado_para_login(resp: httpx.Response) -> bool:
    """Detecta se o endpoint protegido redirecionou de volta para a home de login."""
    if resp.status_code in (301, 302, 303, 307, 308):
        loc = (resp.headers.get("location") or "").lower()
        if "/home" in loc or loc.rstrip("/") == INTRANET_BASE.lower():
            return True
    url_str = str(resp.url).lower().rstrip("/")
    if url_str.endswith("/home") or url_str.endswith("/home/login"):
        return True
    return False


def _autenticar_intranet(client: httpx.Client, usuario: str, senha: str) -> None:
    """Autentica sessão no portal http://192.168.0.6/home/login/."""
    usuario_limpo = str(usuario or "").strip()
    if not usuario_limpo or not senha:
        raise ValueError("Informe o usuário e a senha da Intranet para consultar pedidos novos.")

    try:
        client.get(HOME_URL, follow_redirects=True)
        # O formulário HTML nativo usa enctype="multipart/form-data"
        campos_multipart = {
            "pagina_acessada": (None, f"{INTRANET_BASE}/home/app"),
            "action": (None, "login"),
            "usuario": (None, usuario_limpo),
            "senha": (None, str(senha)),
            "logar": (None, "Acessar"),
        }
        resp_login = client.post(
            LOGIN_URL,
            files=campos_multipart,
            headers={"Origin": INTRANET_BASE, "Referer": f"{INTRANET_BASE}/home/"},
            follow_redirects=True,
        )
    except httpx.RequestError as exc:
        raise ConnectionError(
            f"Não foi possível conectar à Intranet ({INTRANET_BASE}): {exc}"
        ) from exc

    # Caso o retorno continue na tela de login sem redirecionar para /home/app,
    # tentamos fallback urlencoded caso o servidor exija em alguma rota
    url_final = str(resp_login.url).lower().rstrip("/")
    if url_final.endswith("/home") or url_final.endswith("/home/login"):
        resp_fallback = client.post(
            LOGIN_URL,
            data={
                "pagina_acessada": f"{INTRANET_BASE}/home/app",
                "action": "login",
                "usuario": usuario_limpo,
                "senha": str(senha),
                "logar": "Acessar",
            },
            headers={"Origin": INTRANET_BASE, "Referer": f"{INTRANET_BASE}/home/"},
            follow_redirects=True,
        )
        url_fb = str(resp_fallback.url).lower().rstrip("/")
        if url_fb.endswith("/home") or url_fb.endswith("/home/login"):
            raise ValueError(
                "Falha na autenticação da Intranet: verifique se o usuário e a senha estão corretos."
            )


def parse_situacao_pedidos_html(
    html: str, cod_empresa_esperada: str = "11"
) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """
    Extrai (pedido, cod_item) -> {
        'quantidade': float,
        'descricao': str,
        'local_producao': str,
        'linha_produto': str,
        'cliente': str,
        'representante': str,
        'prazo_entrega': str,
    }
    a partir do HTML retornado por /pcp/situacao_pedidos2.php.
    """
    # O script PHP de situacao_pedidos2.php fecha </tr> a cada item no loop sem reabrir <tr>;
    # sem corrigir isso, parsers HTML ejetam as linhas 2..N para fora da tabela interna.
    html_corrigido = re.sub(
        r"(</tr>\s*)(?=<t[dh]\b)",
        r"\1<tr>",
        html or "",
        flags=re.IGNORECASE,
    )
    soup = BeautifulSoup(html_corrigido, "lxml")
    resultado: Dict[Tuple[str, str], Dict[str, Any]] = {}
    emp_alvo = str(cod_empresa_esperada or "").strip()

    for table in soup.find_all("table"):
        # Ignora tabelas externas de moldura (<table class="frame">) para não duplicar linhas
        if table.find("table") is not None:
            continue

        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        idx_header: Optional[int] = None
        col_map: Dict[str, int] = {}

        # Localiza a linha de cabeçalho que possua Pedido + Cod. Item + Quantidade
        for r_idx, tr in enumerate(rows[:15]):
            cells = tr.find_all(["th", "td"], recursive=False)
            if len(cells) < 3:
                continue

            candidato: Dict[str, int] = {}
            for c_idx, cell in enumerate(cells):
                h = _norm_header(cell.get_text(" ", strip=True))
                if not h:
                    continue

                if h in ("pedido", "num pedido", "n pedido", "nro pedido", "nr pedido"):
                    candidato.setdefault("pedido", c_idx)
                elif "pedido" in h and not any(x in h for x in ("dat", "entrega", "compra", "prazo")):
                    candidato.setdefault("pedido", c_idx)
                elif h in ("cod item", "codigo item", "cod do item", "codigo do item", "item", "produto", "cod prod"):
                    candidato.setdefault("cod_item", c_idx)
                elif ("cod" in h and "item" in h) and "pai" not in h:
                    candidato.setdefault("cod_item", c_idx)
                elif h in ("quantidade", "qtde", "qtd", "saldo", "qtd pedida", "qtde pedida", "saldo pedido"):
                    candidato.setdefault("quantidade", c_idx)
                elif "quant" in h or h.startswith("qtde"):
                    candidato.setdefault("quantidade", c_idx)
                elif "descri" in h or h in ("den item", "denominacao"):
                    candidato.setdefault("descricao", c_idx)
                elif ("local" in h and "produ" in h) or h in ("local prod", "local", "fabrica"):
                    candidato.setdefault("local_producao", c_idx)
                elif "linha" in h and "prod" in h:
                    candidato.setdefault("linha_produto", c_idx)
                elif "cliente" in h or "razao" in h:
                    candidato.setdefault("cliente", c_idx)
                elif "repres" in h:
                    candidato.setdefault("representante", c_idx)
                elif "prazo" in h and "entrega" in h:
                    candidato.setdefault("prazo_entrega", c_idx)

            if "pedido" in candidato and "cod_item" in candidato and "quantidade" in candidato:
                idx_header = r_idx
                col_map = candidato
                break

        if idx_header is None:
            continue

        ultimo_pedido = ""
        ultima_empresa = ""
        max_req_idx = max(col_map["pedido"], col_map["cod_item"], col_map["quantidade"])

        for tr in rows[idx_header + 1 :]:
            cells = tr.find_all(["td", "th"], recursive=False)
            if len(cells) <= max_req_idx:
                continue

            textos = [c.get_text(" ", strip=True) for c in cells]
            linha_unida = _norm_header(" ".join(textos))
            if not linha_unida:
                continue

            raw_ped = textos[col_map["pedido"]].strip()
            raw_item = textos[col_map["cod_item"]].strip()
            raw_qtd = textos[col_map["quantidade"]].strip()

            # Ignora repetição de cabeçalho ou linhas de totalização
            if _norm_header(raw_item) in ("cod item", "codigo item", "item", "total", "subtotal", ""):
                continue
            if _norm_header(raw_ped) in ("pedido", "num pedido", "total", "subtotal"):
                continue

            emp_row, ped_norm = extrair_empresa_e_pedido(raw_ped)
            if ped_norm:
                ultimo_pedido = ped_norm
                ultima_empresa = emp_row
            elif ultimo_pedido:
                ped_norm = ultimo_pedido
                emp_row = ultima_empresa
            else:
                continue

            # Ignora linhas vinculadas de outra empresa (ex.: '(18)-23738' ao consultar empresa 11)
            if emp_alvo and emp_row and emp_row != emp_alvo:
                continue

            item_exact = raw_item.upper().strip()
            item_clean = normalizar_cod_item(raw_item)
            if not item_clean:
                continue

            qtd_val = parse_numero_flexivel(raw_qtd, default=0.0)
            if qtd_val <= 0:
                continue

            def _cell_val(chave: str) -> str:
                idx_c = col_map.get(chave)
                if idx_c is None or idx_c >= len(textos):
                    return ""
                val = textos[idx_c].strip()
                return "" if val == "." else val

            desc_val = _cell_val("descricao")
            local_val = _cell_val("local_producao")
            linha_val = _cell_val("linha_produto")
            cli_val = _cell_val("cliente")
            rep_val = _cell_val("representante")
            prazo_val = _cell_val("prazo_entrega")

            for chave_item in {item_exact, item_clean}:
                key = (ped_norm, chave_item)
                if key not in resultado:
                    resultado[key] = {
                        "quantidade": qtd_val,
                        "descricao": desc_val,
                        "local_producao": local_val,
                        "linha_produto": linha_val,
                        "cliente": cli_val,
                        "representante": rep_val,
                        "prazo_entrega": prazo_val,
                    }
                else:
                    resultado[key]["quantidade"] += qtd_val
                    if not resultado[key]["descricao"] and desc_val:
                        resultado[key]["descricao"] = desc_val
                    if (
                        not resultado[key]["local_producao"]
                        or resultado[key]["local_producao"] == "0"
                    ) and local_val and local_val != "0":
                        resultado[key]["local_producao"] = local_val
                    if not resultado[key]["linha_produto"] and linha_val:
                        resultado[key]["linha_produto"] = linha_val
                    if not resultado[key]["cliente"] and cli_val:
                        resultado[key]["cliente"] = cli_val
                    if not resultado[key]["representante"] and rep_val:
                        resultado[key]["representante"] = rep_val
                    if not resultado[key]["prazo_entrega"] and prazo_val:
                        resultado[key]["prazo_entrega"] = prazo_val

    return resultado


def consultar_saldos_pedidos(
    client: httpx.Client, pedidos: Sequence[str]
) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """Consulta /pcp/situacao_pedidos2.php com cod_empresa=11 e lista de pedidos."""
    pedidos_csv = ",".join(pedidos)
    payload = {
        "cod_empresa": "11",
        "inicio": "",
        "fim": "",
        "cod_cliente": "",
        "repi": "",
        "repf": "",
        "repi1": "",
        "repf1": "",
        "repi2": "",
        "repf2": "",
        "repi3": "",
        "repf3": "",
        "repi4": "",
        "repf4": "",
        "num_pedido": pedidos_csv,
        "grupo": "",
        "cod_nat_oper": "",
    }
    resp = client.post(
        SITUACAO_PEDIDOS_URL,
        data=payload,
        headers={
            "Origin": INTRANET_BASE,
            "Referer": SITUACAO_PEDIDOS_URL,
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": "1",
        },
        follow_redirects=False,
    )
    if _foi_redirecionado_para_login(resp):
        raise ValueError(
            "Sessão recusada ao consultar saldo de pedidos: verifique usuário e senha da Intranet."
        )
    resp.raise_for_status()
    html = _decodificar_html(resp)
    return parse_situacao_pedidos_html(html)


def consultar_estrutura_pedidos(
    client: httpx.Client, pedidos: Sequence[str]
) -> List[Dict[str, Any]]:
    """Consulta /JSN001/json-pedido-estrutura.php?pedido=p1,p2."""
    pedidos_csv = ",".join(pedidos)
    url = f"{ESTRUTURA_PEDIDO_URL}?pedido={pedidos_csv}"
    resp = client.get(
        url,
        headers={"Referer": f"{INTRANET_BASE}/home/app"},
        follow_redirects=False,
    )
    if _foi_redirecionado_para_login(resp):
        raise ValueError(
            "Sessão recusada ao consultar estrutura do pedido: verifique usuário e senha da Intranet."
        )
    resp.raise_for_status()

    try:
        body = resp.json()
    except Exception as exc:
        trecho = _decodificar_html(resp)[:200].strip()
        raise ValueError(
            f"Resposta inválida de json-pedido-estrutura.php (esperado JSON): {trecho}"
        ) from exc

    if isinstance(body, dict):
        if body.get("success") is False:
            msg = body.get("message") or body.get("error") or "Consulta de estrutura retornou success=false."
            raise ValueError(str(msg))
        dados = body.get("data")
        if isinstance(dados, list):
            return dados
        return []

    if isinstance(body, list):
        return body

    return []


def consultar_pedidos_simulados(
    usuario: str,
    senha: str,
    pedidos_estrutura: Sequence[str],
    pedidos_saldo: Optional[Sequence[str]] = None,
    timeout: float = 45.0,
) -> Dict[str, Any]:
    """
    Executa login na Intranet e busca em uma única sessão:
    - Saldos dos itens pai em /pcp/situacao_pedidos2.php (apenas para `pedidos_saldo`, quando houver)
    - Árvore de componentes e horizontes em /JSN001/json-pedido-estrutura.php (para `pedidos_estrutura`)
    """
    pedidos_est_limpos: List[str] = []
    vistos_est = set()
    for p in pedidos_estrutura:
        pn = normalizar_numero_pedido(p)
        if pn and pn not in vistos_est:
            vistos_est.add(pn)
            pedidos_est_limpos.append(pn)

    if pedidos_saldo is None:
        pedidos_saldo_limpos = list(pedidos_est_limpos)
    else:
        pedidos_saldo_limpos = []
        vistos_sal = set()
        for p in pedidos_saldo:
            pn = normalizar_numero_pedido(p)
            if pn and pn not in vistos_sal:
                vistos_sal.add(pn)
                pedidos_saldo_limpos.append(pn)

    if not pedidos_est_limpos and not pedidos_saldo_limpos:
        return {
            "estrutura": [],
            "saldos": {},
            "pedidos_encontrados": [],
            "pedidos_sem_estrutura": [],
        }

    with httpx.Client(headers=DEFAULT_HEADERS, timeout=timeout) as client:
        _autenticar_intranet(client, usuario=usuario, senha=senha)
        saldos = (
            consultar_saldos_pedidos(client, pedidos_saldo_limpos)
            if pedidos_saldo_limpos
            else {}
        )
        estrutura = (
            consultar_estrutura_pedidos(client, pedidos_est_limpos)
            if pedidos_est_limpos
            else []
        )

    encontrados_set = {
        normalizar_numero_pedido(row.get("num_pedido"))
        for row in estrutura
        if row.get("num_pedido") is not None
    }
    encontrados_set.discard("")
    sem_estrutura = [p for p in pedidos_est_limpos if p not in encontrados_set]

    return {
        "estrutura": estrutura,
        "saldos": saldos,
        "pedidos_encontrados": sorted(encontrados_set),
        "pedidos_sem_estrutura": sem_estrutura,
    }
