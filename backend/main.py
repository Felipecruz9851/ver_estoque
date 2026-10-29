"""API FastAPI autônoma do projeto Ver Estoque + servidor (python backend/main.py)."""

from pathlib import Path
import sys
from typing import Any, Dict, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

if __package__:
    from . import service, settings
    from .snapshots import listar_snapshots
else:
    _backend_dir = str(Path(__file__).resolve().parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import service
    import settings
    from snapshots import listar_snapshots

router = APIRouter()


class CallPayload(BaseModel):
    payload: Optional[Dict[str, Any]] = None


def _resolver_session_id(request: Request, response: Optional[Response] = None) -> str:
    """
    Identifica a sessão a partir dos cookies do navegador (organização por cookies),
    com suporte a header x-session-id ou geração automática de nova sessão.
    Garante que o cookie Set-Cookie seja emitido para persistência.
    """
    sid = getattr(request.state, "session_id", None)
    if not sid or not service.is_valid_session_id(sid):
        sid = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if not sid or not service.is_valid_session_id(sid):
        header_sid = request.headers.get("x-session-id")
        if header_sid and service.is_valid_session_id(header_sid):
            sid = header_sid

    deve_setar = False
    if not sid or not service.is_valid_session_id(sid):
        sid = service.gerar_session_id()
        deve_setar = True
    elif settings.SESSION_COOKIE_NAME not in request.cookies:
        deve_setar = True

    request.state.session_id = sid

    if deve_setar and response is not None:
        is_https = request.url.scheme == "https"
        response.set_cookie(
            key=settings.SESSION_COOKIE_NAME,
            value=sid,
            max_age=settings.SESSION_COOKIE_MAX_AGE,
            path="/",
            httponly=False,
            samesite="lax",
            secure=is_https,
        )

    return sid


def _executar(method: str, payload: Dict[str, Any], session_id: Optional[str] = None) -> Dict[str, Any]:
    if method == "obter_estoque_itens_finais":
        return service.analisar_itens_finais(
            filtros=payload.get("filtros"),
            page=payload.get("page", 0),
            page_size=payload.get("page_size", 50),
            recarregar=payload.get("recarregar", False),
            session_id=session_id,
        )
    if method == "obter_detalhes_item_final":
        return service.obter_detalhes_item_final(
            raiz_item_final=payload.get("item_final", ""),
            raiz_pedido=payload.get("pedido"),
            raiz_fabrica=payload.get("fabrica"),
            baixa=payload.get("baixa"),
            tipo=payload.get("tipo"),
            session_id=session_id,
        )
    if method == "recarregar_dados_estoque":
        service.obter_cons_com_cache(recarregar=True)
        return {
            "status": "ok",
            "mensagem": "Dados de estoque recarregados com sucesso.",
            "session_id": session_id,
        }
    if method == "exportar_analise_estoque":
        return service.exportar_analise_excel(filtros=payload.get("filtros"), session_id=session_id)
    if method == "simular_pedidos":
        return service.simular_pedidos(
            usuario=str(payload.get("usuario") or ""),
            senha=str(payload.get("senha") or ""),
            pedidos_input=payload.get("pedidos") or [],
            session_id=session_id,
        )
    if method == "remover_pedido_simulado":
        return service.remover_pedido_simulado(
            pedido=str(payload.get("pedido") or ""), session_id=session_id
        )
    if method == "limpar_simulacao":
        return service.limpar_simulacao(session_id=session_id)
    if method == "obter_info_sessao":
        return service.obter_info_sessao(session_id=session_id)
    return {"erro": "Método não permitido ou inexistente"}


@router.post("/call/{method}")
def call_method(method: str, req: CallPayload, request: Request, response: Response):
    session_id = _resolver_session_id(request, response)
    try:
        return _executar(method, req.payload or {}, session_id=session_id)
    except (FileNotFoundError, ValueError, ConnectionError) as e:
        return {"erro": str(e), "session_id": session_id}
    except Exception as e:
        return {"erro": f"Erro ao processar requisição ({method}): {e}", "session_id": session_id}


@router.get("/snapshots")
def snapshots():
    return [p.name for p in listar_snapshots()]


app = FastAPI(title="Ver Estoque")


@app.middleware("http")
async def session_cookie_middleware(request: Request, call_next):
    raw_cookie = request.cookies.get(settings.SESSION_COOKIE_NAME)
    header_sid = request.headers.get("x-session-id")

    if raw_cookie and service.is_valid_session_id(raw_cookie):
        session_id = raw_cookie
        novo_cookie = False
    elif header_sid and service.is_valid_session_id(header_sid):
        session_id = header_sid
        novo_cookie = True
    else:
        session_id = service.gerar_session_id()
        novo_cookie = True

    request.state.session_id = session_id
    response = await call_next(request)

    if novo_cookie or settings.SESSION_COOKIE_NAME not in request.cookies:
        is_https = request.url.scheme == "https"
        response.set_cookie(
            key=settings.SESSION_COOKIE_NAME,
            value=session_id,
            max_age=settings.SESSION_COOKIE_MAX_AGE,
            path="/",
            httponly=False,
            samesite="lax",
            secure=is_https,
        )
    return response


app.include_router(router, prefix="/ver_estoque/api")
app.mount("/ver_estoque/exports", StaticFiles(directory=str(settings.EXPORTS_DIR)), name="exports")

_dist = settings.FRONTEND_DIST
if (_dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_dist / "assets")), name="assets")


@app.get("/favicon.ico", include_in_schema=False)
def favicon_ico():
    icon = _dist / "favicon.ico"
    if icon.exists():
        return FileResponse(icon)
    raise HTTPException(status_code=404)


@app.get("/favicon.svg", include_in_schema=False)
def favicon_svg():
    icon = _dist / "favicon.svg"
    if icon.exists():
        return FileResponse(icon)
    raise HTTPException(status_code=404)


@app.get("/")
@app.get("/ver_estoque")
def pagina():
    page = _dist / "index.html"
    if page.exists():
        return FileResponse(page)
    return {"erro": "Frontend não compilado. Execute 'npm run build' em ./frontend."}


def main():
    import uvicorn

    url_host = "localhost" if settings.HOST in ("0.0.0.0", "::") else settings.HOST
    print(f"Ver Estoque em http://{url_host}:{settings.PORT}  (snapshots: {settings.SNAPSHOTS_DIR})")
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)


if __name__ == "__main__":
    main()
