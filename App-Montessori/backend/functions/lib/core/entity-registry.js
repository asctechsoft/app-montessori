"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEntity = registerEntity;
exports.getEntity = getEntity;
exports.listEntities = listEntities;
const registry = new Map();
function registerEntity(collection, cfg) {
    registry.set(collection, cfg);
}
function getEntity(collection) {
    return registry.get(collection);
}
function listEntities() {
    return [...registry.keys()];
}
