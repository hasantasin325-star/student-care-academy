# Student Care Academy

A self-contained coaching management website built with Node.js, Express, SQLite (`better-sqlite3`) and a responsive browser UI.

## Included
- Public: Home, About/Contact content, Student Login, Parent Login, Teacher Login, Admin Login
- First Admin Setup with no hardcoded credentials
- Roles: Admin, Teacher, Student, Parent
- Class 1–12 and multiple Sections
- Students, parents and teacher records
- Attendance with bulk mark-all + history
- Results with marks, grade/GPA and private JPG/JPEG/PNG result-card image upload
- Fee/due management with non-negative due and audit log
- Manual bKash/Nagad payment requests, admin approval/rejection, receipt
- Class/Exam routines
- Private notices with target, expiry, draft/published/unpublished/expired status
- Read/unread notifications
- Study materials and assignments
- Academy report and audit logs
- Session-based authentication and server-side role checks

## Run
```bash
npm install
npm start
```
Open: http://localhost:3000

On the first visit, the site asks you to create the first Admin account. There is no default admin password.

## Database
SQLite database file: `academy.db` (created automatically beside `server.js`).

Result-card images are stored in the database as private blobs and are served only through an authenticated endpoint.
