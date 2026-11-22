# SafeGuard AI

Camera-based PPE monitoring for construction, factory, warehouse, and industrial
workplaces. The application includes organization setup and RBAC, camera
management, live monitoring, PPE rule evaluation, violations and evidence,
alerts, reports, analytics, restricted zones, migrations, security controls,
and a dedicated video-processing worker.

## Phase 3 camera integration

The `/cameras` page now supports organization-scoped camera management for mobile
browsers, laptop webcams, and IP/RTSP cameras. Mobile cameras receive a
short-lived signed connection token and QR code; the phone uses `getUserMedia`
and a WebRTC peer connection, with FastAPI WebSocket signaling. Set
`PUBLIC_APP_URL` in `backend/.env` to the HTTPS URL reachable by the phone
(camera permissions require HTTPS outside localhost).

RTSP URLs are encrypted with a key derived from `SECRET_KEY` and are never
returned to the frontend. The API stores only camera metadata in responses.

## Phase 4 live monitoring

The `/live` page displays multiple mobile and laptop webcam feeds at once.
Each active feed captures a browser frame once per second and sends it through
an authenticated WebSocket to the backend detection engine. Results return
person boxes, temporary tracking IDs, confidence, PPE status, and counts for
compliant, non-compliant, and uncertain workers. No fake detection result is
created when the PPE model is unavailable; the page reports that configuration
error instead.

## Architecture

```
Browser/mobile camera -> authenticated WebSocket or WebRTC signaling
-> YOLO person and PPE model -> tracker -> equipment association
-> location and restricted-zone rules -> violation/evidence service
-> database -> alert and notification service -> real-time dashboard
```
Live frames are processed through authenticated WebSocket streams. Uploaded
video analysis is queued in PostgreSQL and processed by a separate Docker or
local worker process. Mobile cameras use WebRTC signaling; frames do not travel
through ordinary REST API request handlers.

## Layout

```
backend/app/
  main.py          app factory, migrations startup, evidence authorization
  config.py        env-based settings (SECRET_KEY is required, no default)
  db.py            SQLAlchemy engine and sessions
  models.py        organizations, users, cameras, violations, jobs, and all core tables
  security.py      bcrypt, JWT, current_user, require_roles(...)
  routers/auth.py  first-run setup, login, me
  routers/dashboard.py  aggregated stats from the database
  routers/detection.py protected image, video job, and live-stream endpoints
  workers/        dedicated video-processing worker
  detection.py     YOLO adapter, PPE association, compliance classification and tracking
frontend/src/
  api.js auth.jsx nav.js   API client, session, navigation map
  components/Layout.jsx    sidebar, top bar, light/dark theme
  components/UI.jsx        shared loading, error, page header, and status UI
  pages/                   functional application modules
```

## Run it (easiest)
Double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux). It creates the config, installs everything, starts both servers and opens the browser. Needs Python 3.10+ and Node.js 18+. It uses SQLite, so Docker is not required.

## Run it manually (PostgreSQL)

```bash
# 1. database
docker compose up -d db

# 2. backend
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then set SECRET_KEY:  openssl rand -hex 32
uvicorn app.main:app --reload

# 3. frontend (new terminal)
cd frontend && npm install && npm run dev
```
Open http://localhost:5173. The first visit shows organization setup; that account becomes the admin. API docs: http://localhost:8000/docs.

## Phase 2 detection setup

The detection engine uses a general YOLO model for person detection and a separate
PPE-trained YOLO model for helmet and vest detection. A general COCO model must
not be treated as a PPE model because it cannot reliably identify protective
equipment.

Set the PPE model path in `backend/.env`:

```env
PERSON_MODEL_PATH=yolo11n.pt
PPE_MODEL_PATH=C:\models\ppe-helmet-vest.pt
DETECTION_CONFIDENCE=0.5
```

For the local prototype, an Apache-2.0 model from
`munhim2005/ppe-detection-yolov8` is downloaded into `backend/models/` and
configured automatically in `backend/.env`. It includes `Worker`, `Hard_hat`,
`Vest`, and explicit missing-equipment classes. Replace it with a validated
model for production use.

The model is loaded lazily on the first inference request. The protected
`GET /api/detection/status` endpoint reports whether a PPE model is configured.
The protected `POST /api/detection/analyze-image` endpoint accepts JPEG, PNG, or
WebP images and returns tracked people, equipment matches, confidence scores,
and `compliant`, `non_compliant`, or `uncertain` classifications. A
`non_compliant` result is not generated for an empty/unclear detection; those
results remain `uncertain`. Pass an
organization-owned `camera_id` in the multipart form to persist each result as
a `DetectionEvent`. For confirmed non-compliant people, missing helmet/vest
records also create `Violation` and `Alert` rows. A 60-second per-camera,
tracking-ID, and PPE cooldown prevents duplicate alerts for a continuous
violation. Omitting `camera_id` keeps the upload as a non-persistent analysis
test.

Phase 2 unit tests cover equipment association, uncertainty handling, and
tracking ID continuity:

```bash
cd backend
python -m unittest discover -s tests -v
```

## Verified
Setup, login, wrong-password rejection, token-protected dashboard summary,
Phase 2 detection logic tests, backend startup, and the frontend production
build pass. Real PPE inference still requires a trained PPE model configured
through `PPE_MODEL_PATH`; no fake detection results are generated.

## Phase 5 safety rules

The `/rules` page manages workplace locations and required or optional PPE rules.
Assign a camera to a location from `/cameras`; live, image, and video detection
then evaluates the configured required PPE for that location. Cameras without
configured rules retain the prototype helmet-and-vest default. Generated
violations are available on `/violations`, where administrators and safety
officers can update review status.

The API provides `GET/POST/DELETE /api/locations`, `GET/POST/PATCH/DELETE
/api/rules`, `GET /api/rules/ppe-types`, and `GET/PATCH /api/violations`.

## Phase 6 notifications and alerts

Confirmed violations create persisted in-app notifications for active
organization users. The authenticated `/api/alerts/stream` WebSocket pushes new
alerts to the dashboard, which displays a toast, plays an audible alarm, and
can use browser notifications after permission is granted. The `/alerts` page
supports filtering, acknowledgement, review, resolution, false-positive
classification, comments, evidence review, and escalation of critical alerts
that remain unacknowledged for ten minutes.

## Phase 7 management modules

The management pages now include worker records, editable workplace locations,
camera assignment, PPE safety rules, and restricted-zone definitions. Workers
can be assigned to locations and deactivated without deleting their history.
Restricted zones use validated normalized frame polygons (`0..1` coordinates),
can be edited or deleted, and are scoped to organization-owned cameras.

## Phase 8 reports and analytics

The `/reports` page provides period-based safety compliance reporting for today,
the last seven days, or the current month. It calculates compliance from stored
detection events, groups violations by missing PPE, location, severity, and date,
and renders a chart from the authenticated reports API.

Reports can be downloaded as CSV or PDF. Each export is organization-scoped and
records a `Report` history row. PDF generation requires the `reportlab`
dependency installed by `backend/requirements.txt`.

The API endpoints are `GET /api/reports/summary`, `GET /api/reports/export.csv`,
and `GET /api/reports/export.pdf`; all require an authenticated user.

## Phase 10 main dashboard

The main dashboard now includes daily and 30-day violation trends, daily
compliance trend, overall compliance visualization, violations by PPE item,
location, and camera, most-common violations, and a connected-camera status
section linking to live monitoring. These values are computed by the protected
`GET /api/dashboard/summary` endpoint; no dashboard statistics are hardcoded.

## Phase 11 worker management

The `/workers` page supports organization-scoped worker records with employee
ID, department, designation, assigned location, active/inactive status, and
safe deactivation without deleting history. Each worker now has a History view
backed by `GET /api/workers/{worker_id}/history`, showing linked violations,
missing PPE counts, camera/location context, review status, and a repeated
violation indicator. No facial recognition is used; worker linking remains an
authorized database association.

## Phase 12 restricted zone monitoring

The `/zones` page now supports clickable polygon drawing in normalized camera
coordinates, editing, deletion, and enabling/disabling monitoring. During
inference, the worker feet position is checked against enabled polygons.
Confirmed entries create a critical violation with zone context, captured
evidence, an alert, and in-app notifications, with a 60-second cooldown for
continuous entries.

## Phase 13 advanced safety analytics

The `/analytics` page provides organization-scoped advanced safety insights:
compliance by workplace, department violation totals, a seven-day safety
heatmap, repeated worker violations, camera health and last detection activity,
recent evidence links, and the configured evidence retention period. It also
shows a clearly labeled estimate comparing the current and previous seven-day
violation totals; it is not a prediction of future incidents.

The protected `GET /api/analytics/advanced` endpoint computes these values from
stored detection, violation, worker, camera, and location records.

## Phase 14 reporting module

The `/reports` page supports daily, weekly, and monthly reports with
organization-scoped filters for location, camera, worker, and PPE category.
Report results include compliance, total violations, PPE-wise, worker-wise,
location-wise, and camera-wise breakdowns. CSV and PDF exports preserve the
selected filters and include camera/worker context. The filter catalog is
provided by `GET /api/reports/filters`.

## Phase 15 authentication and roles

The `/settings` page supports authenticated password changes for every role.
Administrators can create organization-scoped users with `admin`,
`safety_officer`, or `viewer` roles, activate or deactivate accounts without
deleting history, and review the organization audit log. Administrators cannot
deactivate their own account.

The protected endpoints are `GET/POST /api/users`, `PATCH /api/users/{user_id}`,
`GET /api/users/audit-logs`, and `POST /api/auth/change-password`. User
creation, account changes, password changes, login, and initial organization
setup are recorded in the audit log. Admin endpoints reject non-admin roles
and all user queries are organization-scoped.

## Phase 16 database migrations and schema

The database schema is managed by Alembic migrations rather than creating tables
implicitly at application startup. The initial migration defines the 16 core
tables, foreign-key relationships, unique constraints, organization-scoped
indexes, and created/updated timestamps described by the SQLAlchemy models.

Fresh databases are migrated automatically when the API starts. Existing
databases created before Phase 16 are upgraded in place so their data and
tables are preserved while missing indexes are added. Future schema changes
must be added as new Alembic revisions.

Run migrations manually from `backend`:

```powershell
# Windows
.\.venv\Scripts\alembic.exe upgrade head

# Create a reviewed migration after changing app/models.py
.\.venv\Scripts\alembic.exe revision --autogenerate -m "describe schema change"
```

For PostgreSQL, set `DATABASE_URL` in `backend/.env` before running the API or
the migration command. SQLite remains supported for local development.

## Phase 17 premium UI/UX

The frontend now uses a consistent SaaS-style visual system:

- Responsive sidebar navigation with a mobile overlay.
- Persistent light/dark theme selection.
- Shared page headers, loading panels, error banners, and status badges.
- Smooth page transitions and reduced-motion support.
- Professional typography, card borders, status colors, and accessible focus states.
- Responsive dashboard, camera, and management layouts.

## Phase 9 testing and deployment

Phase 9 now includes focused automated coverage for PPE association and tracking,
organization-scoped report analytics, compliance score calculation, and CSV
export generation:

```bash
cd backend
python -m unittest discover -s tests -v
```

The backend Docker image packages the configured model, evidence directory, and
PDF dependency. The Compose deployment includes PostgreSQL, a health-checked API,
and a production Nginx frontend with SPA fallback plus API/WebSocket proxying:

```bash
docker compose up --build
```

The containerized frontend is available at `http://localhost:5173`, the API at
`http://localhost:8000`, and API documentation at `http://localhost:8000/docs`.
Docker must be installed and running. Mobile camera access from another device
still requires an HTTPS public URL.

## Phase 18 security and privacy

The application applies security headers and configurable CORS origins.
RTSP/IP camera URLs are validated and stored encrypted; RTSP credentials are
never returned by camera APIs. Image and video uploads enforce MIME, extension,
and configured byte-size limits, and video processing validates organization
camera ownership.

Evidence files are no longer mounted as public static files. They require a
valid signed session and are returned only when the current user belongs to the
violating organization's organization. Login failures are recorded in the audit
log. Configure `CORS_ORIGINS`, `MAX_IMAGE_UPLOAD_BYTES`,
`MAX_VIDEO_UPLOAD_BYTES`, `SECRET_KEY`, and `PUBLIC_APP_URL` through
`backend/.env` for production deployments.

## Phase 19 system architecture

Video analysis is separated from normal API request processing with a database
backed `processing_jobs` queue and a dedicated Docker worker:

- `POST /api/detection/analyze-video` validates and stores the upload, then
  creates a queued job and returns immediately.
- `GET /api/detection/jobs/{job_id}` exposes organization-scoped job status and
  the completed result.
- `app/workers/video_worker.py` claims queued jobs, runs OpenCV/YOLO analysis,
  stores violations and evidence, and updates the job status.
- The Docker Compose `worker` service runs independently from the API service.
- Live camera frames continue through authenticated WebSockets and the inference
  engine, while mobile video uses WebRTC signaling. Ordinary REST APIs are not
  used for per-frame mobile streaming.

Run the worker with Docker:

```bash
docker compose up --build
```

## Phase 20 testing and deployment readiness

Phase 20 adds final deployment smoke coverage and startup automation.

Run the complete backend suite:

```bash
cd backend
python -m unittest discover -s tests -v
```

Run the frontend production build:

```bash
cd frontend
npm install
npm run build
```

Run local development on Windows or macOS/Linux:

```powershell
# Windows
start.bat

# macOS/Linux
./start.sh
```

Both startup scripts start the API and the separate video worker.

### Sample test footage

Use a short MP4, AVI, or MOV clip containing visibly distinct people wearing
and not wearing helmets or safety vests. Obtain footage you are authorized to
use; public or licensed construction-safety footage is suitable for
demonstration. Upload it through `/detection`, or place it in a local test
folder for manual processing.

For helmet/vest-only validation, the existing construction PPE model is
configured by default. Gloves, safety shoes, goggles, masks, ear protection,
harnesses, additional camera types, or very high accuracy require additional
validated datasets and hardware or model training.

## Phase 21 final coding-agent compliance

The project is developed incrementally, with backend, frontend, AI, database,
camera streaming, worker processing, security, and deployment concerns kept in
separate modules. The complete implementation must remain constrained by these
rules:

1. Do not use placeholder dashboard statistics or fabricated AI detections.
2. Keep all API and WebSocket routes authenticated unless intentionally public.
3. Scope every organization-owned resource and database query to the current organization.
4. Validate uploaded images/videos and all user-controlled identifiers.
5. Preserve uncertainty instead of treating unclear PPE detections as confirmed violations.
6. Keep inference outside ordinary API handlers for queued video work.
7. Use Alembic migrations for PostgreSQL and SQLite schema changes.
8. Run backend tests and the frontend production build before reporting a phase complete.
9. Document exact install/run commands, sample footage requirements, hardware limits,
   and additional datasets for unsupported PPE classes.

## Known gaps
- Token is kept in localStorage for now; move to an httpOnly cookie before production.
- Password reset via email remains planned; authenticated password changes and
  admin user/audit-log management are available in Phase 15.
- Real PPE inference requires a PPE-trained YOLO model (helmet and vest classes). Gloves, shoes, goggles, ear protection and harness need additional datasets.
