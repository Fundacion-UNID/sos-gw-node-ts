---
description: Para evitar proponer soluciones que contradicen la arquitectura
  existente, ignoran implementaciones previas, o demuestran una falta de
  entendimiento del código. Asegura que el desarrollo se base en la realidad del
  código y no en suposiciones.
alwaysApply: true
---

Antes de proponer cualquier cambio o nueva funcionalidad, DEBO leer y entender el código relevante existente en el siguiente orden: 1. `server.ts`/Punto de Entrada. 2. `src/models/`. 3. Tests unitarios y de integración relevantes. 4. Managers y Servicios. 5. Rutas/Controladores. La documentación en Markdown debe ser usada como contexto, pero el código es la única fuente de la verdad para la implementación.