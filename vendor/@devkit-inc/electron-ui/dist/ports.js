"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFreePort = findFreePort;
const net_1 = require("net");
/** Ask the OS for a free localhost port. */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = (0, net_1.createServer)();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}
