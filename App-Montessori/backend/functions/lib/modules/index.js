"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actions = void 0;
const org_1 = require("./org");
const entity_1 = require("./entity");
const children_1 = require("./children");
const attendance_1 = require("./attendance");
const care_1 = require("./care");
const comms_1 = require("./comms");
const approvals_1 = require("./approvals");
const hr_1 = require("./hr");
const payroll_1 = require("./payroll");
const finance_1 = require("./finance");
const ops_1 = require("./ops");
const reports_1 = require("./reports");
const admin_1 = require("./admin");
exports.actions = {
    ...org_1.actions,
    ...entity_1.actions,
    ...children_1.actions,
    ...attendance_1.actions,
    ...care_1.actions,
    ...comms_1.actions,
    ...approvals_1.actions,
    ...hr_1.actions,
    ...payroll_1.actions,
    ...finance_1.actions,
    ...ops_1.actions,
    ...reports_1.actions,
    ...admin_1.actions,
};
