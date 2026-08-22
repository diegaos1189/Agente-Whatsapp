# Revision Del Prompt Actual

Fecha de revision: August 21, 2026

## Archivos Revisados

- `apps/api/src/modules/ai/intentClassifier.ts`
- `apps/api/src/modules/ai/entityExtractor.ts`
- `apps/api/src/modules/ai/responseGenerator.ts`

## Estructura Actual

La arquitectura actual de IA esta separada en tres piezas:

1. clasificacion de intencion
2. extraccion de entidades
3. generacion de respuesta

Esta separacion es buena y debe conservarse.

## Lo Que Si Esta Funcionando Bien

### 1. La IA no es la fuente principal de verdad para precios

- La respuesta final recibe hechos calculados por backend.
- Los guardrails bloquean montos inventados.

Referencias:

- `apps/api/src/modules/ai/responseGenerator.ts:18`
- `apps/api/src/modules/ai/guardrails.ts`

### 2. El prompt ya esta aterrizado al dominio

- Ya contempla lenguaje coloquial colombiano.
- Ya cubre variaciones como `regaleme`, `me manda`, `otro igual` y errores ortograficos comunes.

### 3. La generacion de respuesta esta bien restringida

- maximo 1-2 frases
- una sola pregunta
- sin saludo repetido a mitad de conversacion
- sin inventar datos

Para WhatsApp, esto esta bien orientado.

## Lo Que Hoy Sigue Muy Cargado Al Prompt

### 1. La semantica de modificadores

El extractor intenta resolver por lenguaje libre cosas como:

- `sin X`
- `mas X`
- `doble X`
- sabores divididos
- repeticiones implicitas

Eso sirve como MVP, pero es fragil para un sistema de pedidos robusto porque:

- la salida sigue siendo texto libre
- el backend no tiene aun un modelo fuerte de modificadores
- editar por item sigue siendo dificil

### 2. Parte de la memoria conversacional

El extractor hoy debe ayudar a interpretar referencias como:

- `otro`
- `el mismo`
- `igual al anterior`

Eso ayuda, pero cada vez mas deberia resolverse con estado estructurado del carrito y referencias backend, no con razonamiento implicito del LLM.

### 3. Parte del checkout y delivery

El extractor hoy decide:

- tipo de entrega
- metodo de pago
- fragmentos de direccion

Hoy es aceptable, pero cuando entren cobertura, zonas, sedes y mas reglas, esa logica debe moverse a herramientas y validacion de backend.

## Riesgos Del Prompt Actual

### 1. Modificadores sin validacion estructurada

Estado actual:

- los modificadores se mezclan en `sides`
- el backend los trata mas como menciones de texto que como entidades operables

Riesgo:

- combinaciones invalidas
- errores por item
- soporte debil para frases como `uno con ensalada y el otro sin ensalada`

### 2. El matching final de producto sigue siendo heuristico

Aunque la extraccion salga bien, la resolucion final depende de scoring por tokens en `apps/api/src/modules/products/productService.ts:232`.

Riesgo:

- variantes ambiguas
- aliases coloquiales no modelados explicitamente
- matches accidentales en menus mas densos

### 3. Los prompts son mas largos porque faltan herramientas backend

El problema no es primero de redaccion del prompt. El problema es de modelado y tooling.

Cuando existan mas capacidades explicitas en backend, los prompts pueden hacerse mas cortos y mas seguros.

## Direccion Recomendada

### Mantener

- separacion entre clasificar, extraer y redactar
- guardrails de precios
- reglas de brevedad para WhatsApp
- soporte de lenguaje colombiano

### Reducir dentro del prompt

- logica compleja de modificadores
- reconstruccion implicita de reorder
- razonamiento de correccion por item
- supuestos de delivery y cobertura

### Mover a backend

- operaciones explicitas de carrito
- validacion de modificadores
- resolucion de aliases
- validacion de cobertura y tarifa
- reconstruccion de pedido anterior
- referencias de linea/item del carrito

## Forma Deseable Del Prompt A Futuro

### Intent classifier

Mantenerlo parecido a como esta.

Mejora sugerida:

- solo ampliar intents cuando realmente exista una accion de backend que los aproveche

### Entity extractor

Mantenerlo, pero reducir responsabilidad con el tiempo:

- extraer lo que el cliente dijo
- dejar al backend resolver:
  - product id exacto
  - variant id exacto
  - modifier ids exactos
  - linea exacta del carrito

### Response generator

Mantenerlo y adelgazarlo aun mas:

- hechos verificados entran
- una sola pregunta exacta entra
- respuesta corta de WhatsApp sale

Esta pieza ya esta cerca de la forma ideal.

## Conclusiones

El sistema actual ya esta bastante mejor que un chatbot con un solo prompt gigante.

La siguiente mejora no deberia ser "reescribir el prompt completo".

La siguiente mejora deberia ser quitarle responsabilidad al prompt mediante backend mas fuerte en:

- carrito
- aliases
- modificadores
- reorder
- delivery

Con eso, el prompt puede quedar mas corto, mas mantenible y menos propenso a errores.
