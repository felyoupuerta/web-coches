## Reglas de Trabajo con el Grafo de Conocimiento (Graphify)

1. **Mapea antes de tocar:** Queda estrictamente prohibido modificar o generar código sin antes analizar el grafo de dependencias (`graph.html` / datos del grafo).
2. **Análisis de Impacto Obligatorio:** Ante cualquier cambio de código, refactorización o nueva funcionalidad, debes:
   - Localizar los nodos afectados en el grafo.
   - Trazar el impacto de primer nivel y de dependencias lejanas.
   - Revisar qué tests existentes cubren esas zonas.
   - Presentar un plan de cambios antes de escribir una sola línea de código.
3. **Mantenimiento del Grafo:** Si realizas cambios estructurales (creación de nuevos módulos, eliminación de archivos, cambio de rutas o refactorizaciones grandes), debes avisarme para volver a ejecutar la generación del grafo y mantener la documentación viva.