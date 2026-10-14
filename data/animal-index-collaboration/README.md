# Ejemplo: colaborador de protectora invitado por ayuntamiento

Este ejemplo modela un colaborador externo (empleado de protectora) que opera bajo licencias del ayuntamiento.

## Regla de modelado

- `memberOf`: entidad en cuyo contexto/licencia actua el colaborador.
- `worksFor`: empleador real del colaborador.
- El `sector` operativo para endpoints DID sale del URN de `identifier` (en este caso `animal-index` para el ayuntamiento).
- La naturaleza juridica de la entidad puede mantenerse en `Organization.additionalType` (ejemplo: `public-administration`).

## Archivos

- `organization-ayuntamiento.vc-subject.json`
- `person-colaborador-protectora.vc-subject.json`

## URNs del ejemplo

- Ayuntamiento (sector operativo):
  - `urn:<namespace>:<network>:es:v1:animal-index:entity:tax:P2807900B`
- Protectora/clinica (empleador real):
  - `urn:<namespace>:<network>:es:v1:animal-care:entity:tax:B12345678`
- Persona colaboradora (dada de alta por el ayuntamiento):
  - `urn:<namespace>:<network>:es:v1:animal-index:entity:tax:P2807900B:employee:laura.perez@protectora.example:role:ISCO-08|3240`

## Resultado esperado del ejemplo

- En `Person.memberOf` queda el URN del ayuntamiento (`animal-index`).
- En `Person.worksFor` queda el URN de la protectora (`animal-care`).

## Claims planas (opcional para API)

Si necesitas pasar este mismo modelo como claims planas:

```json
{
  "@context": "org.schema",
  "@type": "template",
  "org.schema.Person.identifier": "urn:<namespace>:<network>:es:v1:animal-index:entity:tax:P2807900B:employee:laura.perez@protectora.example:role:ISCO-08|3240",
  "org.schema.Person.memberOf": "urn:<namespace>:<network>:es:v1:animal-index:entity:tax:P2807900B",
  "org.schema.Person.worksFor": "urn:<namespace>:<network>:es:v1:animal-care:entity:tax:B12345678",
  "org.schema.Person.email": "laura.perez@protectora.example"
}
```

Nota: si vuestra normalizacion filtra claims por allowlist, asegura que `Organization.additionalType` y `Person.memberOf` esten permitidos donde corresponda.
