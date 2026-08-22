# Catalog Resolution

Fecha: August 21, 2026

## Objetivo

Resolver referencias naturales del cliente contra el catalogo real sin hardcodear menu en el prompt y sin inventar productos.

## Flujo

Input del cliente
-> `normalizeCatalogText()`
-> aliases persistidos (`searchKeywords`) + aliases derivados
-> exact name / exact alias
-> normalized exact / alias normalized
-> token matching
-> fuzzy acotado
-> `MATCHED | AMBIGUOUS | NOT_FOUND`
-> validacion de disponibilidad
-> carrito / respuesta conversacional

## Fuente de verdad

- La IA interpreta el ultimo mensaje y extrae entidades amplias.
- El backend resuelve el producto o modificador real.
- `apps/api/src/modules/products/productService.ts` es el resolvedor central.

## Aliases

Se reutiliza `products.searchKeywords` como almacenamiento persistente.

Encima de eso, backend deriva aliases seguros a partir de:

- `name`
- `unitCount`
- `isCombo`
- variantes frecuentes del nombre, por ejemplo:
  - `pollo de 8`
  - `combo de 8`
  - `8 presas`
  - `el familiar`
  - `el grande`

Esto permite mejorar precision sin migracion destructiva.

## Normalizacion

Antes de buscar:

- baja a minusculas
- quita tildes
- limpia puntuacion
- colapsa espacios
- singulariza tokens simples
- convierte numeros escritos frecuentes (`ocho` -> `8`)

Ejemplos equivalentes:

- `pollo de ocho`
- `pollo de 8`
- `POLLO DE 8`

## Ambiguedad

El resolvedor nunca elige arbitrariamente entre candidatos cercanos.

Retorna:

- `MATCHED` cuando hay un ganador claro
- `AMBIGUOUS` cuando dos o mas candidatos quedan demasiado cerca
- `NOT_FOUND` cuando no hay soporte suficiente

Ejemplo:

- `el familiar`
  - si solo existe un familiar real -> `MATCHED`
  - si existen Familiar 8 y Familiar 12 -> `AMBIGUOUS`

## Disponibilidad

La resolucion consulta tambien productos no disponibles para poder responder:

- `MATCHED` + `available=false`

Entonces conversacion puede decir:

- `Combo 8 esta agotado en este momento`

sin agregarlo al carrito.

## Carrito estructurado

`apps/api/src/modules/conversation/structuredCart.ts` ahora reutiliza el mismo resolvedor para:

- agregar modificadores
- reemplazar componentes
- rechazar referencias demasiado vagas
- pedir aclaracion cuando la referencia si existe pero es ambigua

## Distribucion de sabores

Se agrego parsing backend para distribuciones como:

- `20 alitas mitad BBQ mitad picantes`
- `20 alitas, 10 BBQ y 10 picantes`

Valida que la suma coincida con la cantidad total y no reparte automaticamente cantidades impares.

## Limites actuales

Esta fase no crea aun un modelo formal de:

- grupos de modificadores
- min/max por grupo
- requeridos vs opcionales
- multi-tenant explicito en esquema

Queda lista la base de resolucion para endurecer esa capa en la siguiente iteracion.
