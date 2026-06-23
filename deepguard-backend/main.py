import os
import time
import base64
import io
import math
from datetime import datetime, timezone
from typing import Optional, List

import numpy as np
from scipy.ndimage import convolve, uniform_filter
from PIL import Image
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, ConfigDict
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float
from sqlalchemy.orm import sessionmaker, Session, declarative_base
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

DEEPGUARD_API_KEY = os.environ.get("DEEPGUARD_API_KEY", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./deepguard.db")
RAW_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in RAW_ORIGINS.split(",") if o.strip()] if RAW_ORIGINS else ["*"]
MAX_IMAGE_BYTES = 6 * 1024 * 1024

if not DEEPGUARD_API_KEY:
    print("WARNING: DEEPGUARD_API_KEY is not set. API authentication is disabled.")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class SessionRecord(Base):
    __tablename__ = "session_records"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    video_trust_score = Column(Float, nullable=True)
    audio_trust_score = Column(Float, nullable=True)
    ip_address = Column(String(64), nullable=True)
    city = Column(String(128), nullable=True)
    country = Column(String(128), nullable=True)
    isp_org = Column(String(256), nullable=True)
    timezone = Column(String(64), nullable=True)
    browser = Column(String(128), nullable=True)
    platform = Column(String(128), nullable=True)
    screen_res = Column(String(64), nullable=True)
    client_ip = Column(String(64), nullable=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not DEEPGUARD_API_KEY:
        raise HTTPException(status_code=503, detail="Server not configured: DEEPGUARD_API_KEY missing")
    if not x_api_key or x_api_key != DEEPGUARD_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")

def _rate_limit_key(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)

limiter = Limiter(key_func=_rate_limit_key)
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.join(os.path.dirname(__file__), ".."))

app = FastAPI(title="DeepGuard Backend", version="1.0.0")
app.state.limiter = limiter

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'none'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; script-src 'self'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:"
    if "server" in response.headers: del response.headers["server"]
    if "Server" in response.headers: del response.headers["Server"]
    return response

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return {"error": "rate_limit_exceeded", "detail": str(exc.detail)}, 429

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

class ScanFrameRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded JPEG frame, no data: prefix")
    @field_validator("image_base64")
    @classmethod
    def validate_base64_size(cls, v):
        if len(v) > MAX_IMAGE_BYTES * 1.4:
            raise ValueError("Image payload too large")
        try:
            base64.b64decode(v, validate=True)
        except Exception:
            raise ValueError("image_base64 is not valid base64")
        return v

class ScanFrameResponse(BaseModel):
    trust_score: int
    verdict: str
    reasoning: str
    latency_ms: int

class AudioFeatures(BaseModel):
    centroid: float = 0
    spread: float = 0
    flux: float = 0
    zcr: float = 0
    energyRatio: float = 0.5
    harmonicConfidence: float = 0.5
    stabilityScore: float = 0.8

class AudioAnalysisResponse(BaseModel):
    trust_score: int
    verdict: str
    reasoning: str

class SessionIntel(BaseModel):
    model_config = ConfigDict(str_max_length=256)
    ip: Optional[str] = Field(None, max_length=64)
    city: Optional[str] = Field(None, max_length=128)
    country: Optional[str] = Field(None, max_length=128)
    org: Optional[str] = Field(None, max_length=256)
    timezone: Optional[str] = Field(None, max_length=64)
    browser: Optional[str] = Field(None, max_length=128)
    platform: Optional[str] = Field(None, max_length=128)
    screen: Optional[str] = Field(None, max_length=64)

class CreateSessionRequest(BaseModel):
    video_trust_score: Optional[float] = None
    audio_trust_score: Optional[float] = None
    intel: Optional[SessionIntel] = None

class SessionResponse(BaseModel):
    id: int
    timestamp: datetime
    video_trust_score: Optional[float]
    audio_trust_score: Optional[float]
    ip_address: Optional[str]
    city: Optional[str]
    country: Optional[str]
    isp_org: Optional[str]
    timezone: Optional[str]
    browser: Optional[str]
    platform: Optional[str]
    screen_res: Optional[str]
    model_config = ConfigDict(from_attributes=True)

def _compute_laplacian_variance(gray: np.ndarray) -> float:
    lap = np.array([[1, 1, 1], [1, -8, 1], [1, 1, 1]], dtype=float)
    result = convolve(gray, lap, mode='constant', cval=0.0)
    return float(np.var(result))

def _compute_frequency_artifacts(gray: np.ndarray) -> float:
    h, w = gray.shape
    fft = np.fft.fft2(gray.astype(float))
    fft_shift = np.fft.fftshift(fft)
    magnitude = np.abs(fft_shift)
    magnitude[magnitude < 1] = 1
    log_mag = np.log10(magnitude)
    cy, cx = h // 2, w // 2
    band_radius = max(2, min(h, w) // 20)
    y, x = np.ogrid[-band_radius:band_radius+1, -band_radius:band_radius+1]
    mask = (y != 0) | (x != 0)
    ny = np.clip(cy + y, 0, h - 1)
    nx = np.clip(cx + x, 0, w - 1)
    vals = log_mag[ny, nx]
    local_mean = uniform_filter(log_mag, size=5, mode='constant', cval=0)
    peaks = (vals > local_mean[ny, nx] * 1.5) & mask
    peak_count = np.sum(peaks)
    total = np.sum(mask)
    ratio = peak_count / max(total, 1)
    return max(0, min(1, 1 - ratio * 3))

def _compute_color_histogram_anomaly(img: np.ndarray) -> float:
    if img.ndim < 3 or img.shape[2] < 3:
        return 0.5
    r, g, b = img[:,:,0].ravel(), img[:,:,1].ravel(), img[:,:,2].ravel()
    r_hist, _ = np.histogram(r, bins=64, range=(0, 256))
    g_hist, _ = np.histogram(g, bins=64, range=(0, 256))
    b_hist, _ = np.histogram(b, bins=64, range=(0, 256))
    # Check for empty bins (color banding)
    empty_bins = np.sum(r_hist == 0) + np.sum(g_hist == 0) + np.sum(b_hist == 0)
    empty_ratio = empty_bins / (64 * 3)
    # Natural images rarely have >40% empty bins
    if empty_ratio > 0.4:
        score = max(0, 1 - (empty_ratio - 0.4) * 2)
    else:
        score = 1.0
    # Check for unusual saturation
    r_mean, g_mean, b_mean = np.mean(r), np.mean(g), np.mean(b)
    mean_diff = max(abs(r_mean - g_mean), abs(g_mean - b_mean), abs(b_mean - r_mean))
    # Extremely uniform color suggests synthetic
    if mean_diff < 5:
        score *= 0.6
    return score

def _compute_noise_analysis(gray: np.ndarray) -> float:
    h, w = gray.shape
    if h < 4 or w < 4:
        return 0.5
    kernel = np.array([[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]], dtype=float)
    noise_map = convolve(gray, kernel, mode='constant', cval=0.0)
    noise_std = float(np.std(noise_map))
    noise_mean = float(np.mean(np.abs(noise_map)))
    if 0.5 < noise_std < 20:
        score = 0.9 if noise_mean > 2 else (0.7 if noise_mean > 0.5 else 0.5)
    elif noise_std <= 0.5:
        score = 0.3
    else:
        score = 0.5
    return score

def _compute_edge_analysis(gray: np.ndarray) -> float:
    sobel_x = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=float)
    sobel_y = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=float)
    gx = convolve(gray, sobel_x, mode='constant', cval=0.0)
    gy = convolve(gray, sobel_y, mode='constant', cval=0.0)
    mag = np.sqrt(gx**2 + gy**2)
    edge_mean = float(np.mean(mag))
    edge_std = float(np.std(mag))
    if edge_mean < 1:
        score = 0.3
    elif edge_std < 2 and edge_mean > 5:
        score = 0.4
    else:
        score = min(1, 0.5 + edge_std / 50)
    return score

def analyze_image_frame(image_bytes: bytes) -> tuple:
    start = time.perf_counter()
    try:
        img_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return 50, "UNCERTAIN", "Could not decode image", 0
    img = np.array(img_pil, dtype=np.float32)
    gray = np.mean(img, axis=2) if img.ndim == 3 else img.copy()

    lap_var = _compute_laplacian_variance(gray)
    freq_score = _compute_frequency_artifacts(gray)
    color_score = _compute_color_histogram_anomaly(img)
    noise_score = _compute_noise_analysis(gray)
    edge_score = _compute_edge_analysis(gray)

    blur_score = min(1, lap_var / 500) if lap_var < 300 else 1.0
    if lap_var < 20:
        blur_score = 0.2
    elif lap_var < 50:
        blur_score = 0.5

    # Weighted ensemble
    weights = {"blur": 0.25, "freq": 0.20, "color": 0.15, "noise": 0.20, "edge": 0.20}
    raw = (
        blur_score * weights["blur"] +
        freq_score * weights["freq"] +
        color_score * weights["color"] +
        noise_score * weights["noise"] +
        edge_score * weights["edge"]
    )
    trust_score = max(0, min(100, round(raw * 100)))

    details = []
    if blur_score < 0.3:
        details.append("frame appears unusually blurry")
    elif blur_score > 0.8:
        details.append("natural texture detail present")
    if freq_score < 0.4:
        details.append("unusual frequency patterns detected")
    if color_score < 0.5:
        details.append("color histogram shows banding artifacts")
    if noise_score < 0.4:
        details.append("lacks expected camera sensor noise")
    if edge_score < 0.4:
        details.append("edge distribution is unnaturally uniform")

    if trust_score >= 65:
        verdict = "LIKELY AUTHENTIC"
        reasoning = "Frame passes all forensic checks. " + (" ".join(details) if details else "Natural camera characteristics detected.")
    elif trust_score >= 35:
        verdict = "UNCERTAIN"
        reasoning = "Some anomalies found: " + ("; ".join(details) if details else "mixed signals.")
    else:
        verdict = "LIKELY SYNTHETIC"
        reasoning = "Multiple synthetic indicators: " + ("; ".join(details) if details else "frame fails authenticity checks.")

    latency_ms = int((time.perf_counter() - start) * 1000)
    return trust_score, verdict, reasoning, latency_ms

@app.post("/api/scan-frame", response_model=ScanFrameResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("20/minute")
async def scan_frame(request: Request, payload: ScanFrameRequest):
    try:
        image_bytes = base64.b64decode(payload.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 data")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    trust_score, verdict, reasoning, latency_ms = analyze_image_frame(image_bytes)
    return ScanFrameResponse(trust_score=trust_score, verdict=verdict, reasoning=reasoning, latency_ms=latency_ms)

@app.post("/api/analyze-audio", response_model=AudioAnalysisResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("60/minute")
async def analyze_audio(request: Request, features: AudioFeatures):
    centroid = features.centroid
    spread = features.spread
    flux = features.flux
    zcr = features.zcr
    energy_ratio = features.energyRatio
    harmonic_conf = features.harmonicConfidence
    stability = features.stabilityScore

    centroid_score = 0.9 if 200 < centroid < 3000 else (0.7 if 100 < centroid < 4000 else 0.4)
    spread_score = 0.85 if 200 < spread < 2500 else (0.65 if 100 < spread < 4000 else 0.4)
    zcr_score = 0.85 if 0.02 < zcr < 0.25 else (0.6 if 0.01 < zcr < 0.4 else 0.3)
    energy_score = 0.9 if 0.4 < energy_ratio < 0.9 else (0.7 if 0.2 < energy_ratio < 0.95 else 0.4)
    harmonic_score = 0.85 if 0.1 < harmonic_conf < 0.6 else (0.65 if harmonic_conf < 0.8 else 0.35)

    score = (
        stability * 0.30 +
        centroid_score * 0.15 +
        spread_score * 0.10 +
        zcr_score * 0.10 +
        energy_score * 0.15 +
        harmonic_score * 0.20
    ) * 100

    score = max(0, min(100, round(score)))
    if score >= 65:
        verdict = "LIKELY AUTHENTIC"
        reasoning = f"Spectral features consistent with natural human voice (centroid={centroid:.0f}Hz, stability={stability:.2f})."
    elif score >= 35:
        verdict = "UNCERTAIN"
        reasoning = f"Some spectral anomalies detected (flux={flux:.1f}, zcr={zcr:.3f}). May indicate processing artifacts."
    else:
        verdict = "POSSIBLE SYNTHETIC"
        reasoning = f"Spectral features deviate significantly from expected human voice range. Synthetic voice patterns suspected."
    return AudioAnalysisResponse(trust_score=score, verdict=verdict, reasoning=reasoning)

@app.post("/api/sessions", response_model=SessionResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("60/minute")
async def create_session(request: Request, payload: CreateSessionRequest, db: Session = Depends(get_db)):
    intel = payload.intel or SessionIntel()
    record = SessionRecord(
        video_trust_score=payload.video_trust_score,
        audio_trust_score=payload.audio_trust_score,
        ip_address=intel.ip,
        city=intel.city,
        country=intel.country,
        isp_org=intel.org,
        timezone=intel.timezone,
        browser=intel.browser,
        platform=intel.platform,
        screen_res=intel.screen,
        client_ip=get_remote_address(request),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record

@app.get("/api/sessions", response_model=List[SessionResponse], dependencies=[Depends(require_api_key)])
@limiter.limit("60/minute")
async def list_sessions(request: Request, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    records = (
        db.query(SessionRecord)
        .order_by(SessionRecord.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return records

@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}

index_path = os.path.join(FRONTEND_DIR, "index.html")
if os.path.exists(index_path):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    import mimetypes
    mimetypes.add_type("image/jpeg", ".jpg")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(index_path)
