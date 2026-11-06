"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./core/firebase");
const router_1 = require("./core/router");
const modules_1 = require("./modules");
const handle = (0, router_1.createRouter)(modules_1.actions);
/** Cloud Function callable duy nhất cho web + mobile. Xem docs/CONTRACT.md §4. */
exports.api = (0, https_1.onCall)({ region: firebase_1.REGION, cors: true, memory: '512MiB', timeoutSeconds: 120, maxInstances: 50 }, (req) => handle(req));
__exportStar(require("./triggers"), exports);
