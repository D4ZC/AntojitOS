import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { checkNpmRegistry } from "./check-npm-registry.mjs";

const withRegistry = async (handler, check) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await check(`http://127.0.0.1:${server.address().port}/-/ping`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

test("permite preparar dependencias cuando el registro responde", async () => {
  await withRegistry((request, response) => {
    assert.equal(request.url, "/-/ping");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  }, async (url) => {
    await checkNpmRegistry({ url });
  });
});

test("reporta un registro que rechaza la descarga sin ocultar la causa HTTP", async () => {
  await withRegistry((request, response) => {
    response.writeHead(503);
    response.end("unavailable");
  }, async (url) => {
    await assert.rejects(checkNpmRegistry({ url }), (error) => {
      assert.match(error.message, /registry\.npmjs\.org desde el contenedor/u);
      assert.match(error.cause.message, /HTTP 503/u);
      return true;
    });
  });
});

test("termina con un diagnostico cuando no llegan las cabeceras", async () => {
  await withRegistry(() => {}, async (url) => {
    await assert.rejects(checkNpmRegistry({ url, timeoutMilliseconds: 50 }), (error) => {
      assert.match(error.message, /ETIMEDOUT/u);
      assert.match(error.message, /mismo ZIP/u);
      return true;
    });
  });
});

test("tambien limita la espera cuando la respuesta se queda incompleta", async () => {
  await withRegistry((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"pending":');
  }, async (url) => {
    await assert.rejects(checkNpmRegistry({ url, timeoutMilliseconds: 50 }), (error) => {
      assert.match(error.message, /ETIMEDOUT/u);
      return true;
    });
  });
});

test("conserva el codigo de conexion y ofrece pasos para reintentar", async () => {
  const cause = new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ETIMEDOUT" }) });
  await assert.rejects(checkNpmRegistry({ fetchRegistry: async () => { throw cause; } }), (error) => {
    assert.equal(error.cause, cause);
    assert.match(error.message, /ETIMEDOUT/u);
    assert.match(error.message, /DNS, VPN o cortafuegos de Podman/u);
    assert.match(error.message, /ACTUALIZAR-APP\.cmd/u);
    return true;
  });
});
