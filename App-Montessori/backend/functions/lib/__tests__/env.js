"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Phải được import ĐẦU TIÊN trong mọi file test: thiết lập project/emulator trước khi core/firebase khởi tạo Admin SDK.
process.env.GCLOUD_PROJECT ??= 'app-montessori-36ec6';
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
