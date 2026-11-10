from .agent import router as agent_router
from .pixelfx import router as pixelfx_router
from .ui import router as ui_router

ROUTERS = [agent_router, ui_router, pixelfx_router]
