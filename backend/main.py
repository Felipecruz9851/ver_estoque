"""API FastAPI autônoma do projeto Ver Estoque + servidor (python backend/main.py)."""

from pathlib import Path
import sys
from typing import Any, Dict, Optional

from fastapi import APIRouter, FastAPI, HTTPException
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


def _executar(method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if method == "obter_estoque_itens_finais":
        return service.analisar_itens_finais(
            filtros=payload.get("filtros"),
            page=payload.get("page", 0),
            page_size=payload.get("page_size", 50),
            recarregar=payload.get("recarregar", False),
        )
    if method == "obter_detalhes_item_final":
        return service.obter_detalhes_item_final(
            raiz_item_final=payload.get("item_final", ""),
            raiz_pedido=payload.get("pedido"),
            raiz_fabrica=payload.get("fabrica"),
            baixa=payload.get("baixa"),
            tipo=payload.get("tipo"),
        )
    if method == "recarregar_dados_estoque":
        service.obter_cons_com_cache(recarregar=True)
        return {"status": "ok", "mensagem": "Dados de estoque recarregados com sucesso."}
    if method == "exportar_analise_estoque":
        return service.exportar_analise_excel(filtros=payload.get("filtros"))
    return {"erro": "Método não permitido ou inexistente"}


@router.post("/call/{method}")
def call_method(method: str, req: CallPayload):
    try:
        return _executar(method, req.payload or {})
    except (FileNotFoundError, ValueError) as e:
        return {"erro": str(e)}


@router.get("/snapshots")
def snapshots():
    return [p.name for p in listar_snapshots()]


app = FastAPI(title="Ver Estoque")
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
