# ADR-0003: PWA touch-first para terminales Windows

- **Estado:** aceptado para el piloto
- **Fecha:** 2026-10-06

## Contexto

Las dos primeras terminales son mini tablets Windows touch. Se busca despliegue web, actualización central y uso a pantalla completa.

## Decisión

El POS será React/Vite y se instalará como PWA en Microsoft Edge. El diseño parte de interacción con dedo, orientación horizontal y objetivos de 44–48 px. Un agente local separado resolverá periféricos que el navegador no controla de forma confiable.

## Consecuencias

- Una sola interfaz sirve para terminales y futuras tablets compatibles.
- No se depende de `hover`, teclado físico ni APIs propietarias del navegador.
- Deben probarse resolución, escala de Windows, teclado virtual y modo aplicación en el hardware real.
- La impresión silenciosa no se implementará con `window.print`; usará trabajos durables y agente.

