# Customizing the OpenAPI specification

Use an [OpenAPI Overlay](https://spec.openapis.org/overlay/v1.1.0.html) to describe changes in a separate YAML file and build a specification for your environment or tools. The downloaded specification stays unchanged.

This can cover deployment-specific custom fields, response changes made by plugins, and adjustments for a code generator. An Overlay changes the API description; it does not transform requests or responses.

## Choose a release asset

Download a specification from the [release](https://github.com/d-yoshi/redmine-openapi/releases) matching your Redmine version and pin its exact tag, including the revision.

| Asset                 | Difference                                                                                           | Typical use                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `openapi.yaml`        | Removes `additionalProperties: false` from schemas, allowing undeclared properties in those objects. | General use, including client generation.                                                  |
| `openapi.strict.yaml` | Keeps `additionalProperties: false` where the source schemas declare it.                             | Checking responses for undeclared properties, including after an upgrade or plugin change. |

Other constraints, including types, required properties, and `oneOf`, are the same. The strict asset does not specialize custom fields for your installation or resolve generator compatibility issues. Both assets can be customized with an Overlay.

If a plugin adds response properties, declare them in your Overlay when using the strict asset. Explicitly extensible objects, such as maps of custom-field IDs to values, remain extensible in both assets.

## Prepare the build

The commands below use release `7.0.2-r3` and Redocly CLI `2.71.0` as a worked example, with Node.js 24. Choose the release for your installation. You do not need to clone this repository.

```sh
mkdir redmine-api-custom
cd redmine-api-custom

REDMINE_SPEC_TAG=7.0.2-r3
curl --fail --location \
  "https://github.com/d-yoshi/redmine-openapi/releases/download/${REDMINE_SPEC_TAG}/openapi.yaml" \
  --output openapi.base.yaml
```

To start from the strict asset instead, replace `openapi.yaml` in the download URL with `openapi.strict.yaml`, keeping the local filename `openapi.base.yaml`.

Save the following as `redocly.yaml`:

```yaml
extends:
  - recommended-strict
rules:
  tag-description: off
```

Use this standalone configuration for the examples. The repository's own build configuration includes a decorator that removes `additionalProperties: false` for distribution; reusing it could remove constraints you intended to keep.

Choose an example below and save it as `custom.overlay.yaml`. Each example is independent.

## Example: single-valued custom fields

Suppose every custom field returned by the APIs you use is single-valued and returns a string or `null`. You can narrow the shared response value schema:

```yaml
overlay: 1.1.0
info:
  title: Single-valued custom-field responses
  version: 1.0.0
actions:
  - target: $.components.schemas.custom_field_value.properties.value.oneOf
    remove: true
  - target: $.components.schemas.custom_field_value.properties.value
    update:
      type: string
      nullable: true
```

This affects every response referencing `custom_field_value`, across resource types. It rejects array values, so use it only if that matches your installation. For fields with different contracts, define separate schemas and reference them from the relevant responses instead of narrowing this shared schema globally.

This example changes responses only. Request fields use separate schemas: `custom_fields` is an array of field objects, while `custom_field_values` is a map keyed by field ID. Customize them separately if needed.

Match the JSON representation actually returned by Redmine. For example, a numeric custom field can still return a JSON string such as `"42"`; changing its schema to `integer` would not convert that value.

## Example: a plugin changes a response type

Suppose a plugin changes issue descriptions from a string or `null` to an object containing `plain` and `html` strings, or `null`. The following hypothetical profile replaces the description schema in both issue detail and list responses:

```yaml
overlay: 1.1.0
info:
  title: Plugin issue descriptions
  version: 1.0.0
actions:
  - target: "$.components.schemas['issue', 'issue.summary'].properties.description"
    remove: true
  - target: "$.components.schemas['issue', 'issue.summary'].properties"
    update:
      description:
        type: object
        nullable: true
        additionalProperties: false
        required:
          - plain
          - html
        properties:
          plain:
            type: string
          html:
            type: string
```

Replace the hypothetical structure with your plugin's actual response contract. Deleting the old schema first avoids retaining constraints from its previous type. The outer issue schema still requires `description`, as before; the request schemas are unchanged.

The same approach can add plugin properties or change nullability and required properties. Check all affected response schemas, including separate list and detail schemas.

## Example: a generator cannot handle custom-field unions

Before changing the specification for generation, check whether your generator offers suitable configuration or type mappings. If it cannot handle the custom-field `oneOf` schemas, one option is to leave those values unconstrained:

```yaml
overlay: 1.1.0
info:
  title: Unconstrained custom-field values for generation
  version: 1.0.0
actions:
  - target: $.components.schemas.custom_field_value.properties.value.oneOf
    remove: true
  - target: $.components.schemas.custom_fields.items.properties.value.oneOf
    remove: true
  - target: $.components.schemas.custom_field_values.additionalProperties.oneOf
    remove: true
```

For the example release, each affected value schema becomes `{}`. This permits any value and loses the original string-or-array constraints, including their checks on array items. The generated type depends on your generator and language; verify the result with that tool.

This removes only the three custom-field unions. Other unsupported constructs require separate handling. Keep a specification with the original constraints for response validation if you loosen them solely for generation.

## Build and verify

Apply the chosen Overlay and lint the result:

```sh
npx --yes @redocly/cli@2.71.0 bundle openapi.base.yaml \
  --config redocly.yaml \
  --overlay custom.overlay.yaml \
  --output openapi.custom.yaml

npx --yes @redocly/cli@2.71.0 lint openapi.custom.yaml \
  --config redocly.yaml
```

Use `openapi.custom.yaml` as the input to your generator or response validator. Keep `openapi.base.yaml` unchanged so you can review the resulting differences.

Lint checks the specification, not whether it matches your plugin's runtime behavior or works with a particular generator. Also check representative responses against the customized schemas, and generate and compile your client with the generator and options you actually use.

When writing or combining Overlays:

- Actions run in order. Object updates merge, and array updates append. To replace an entire schema or an array such as `required` or `oneOf`, remove it first, then add the replacement through its parent object.
- Targets refer to the bundled specification. A component name containing a dot, such as `issue.summary`, needs bracket notation as shown above.
- A target matching nothing is a successful no-op. A successful build or lint does not prove that every intended change took effect; inspect the output and its differences from the base.
- Multiple `--overlay` options apply in the order given. Review their combined effect, especially when one Overlay narrows a type and another loosens it.

## Update the base specification

Keep the base release tag, chosen asset, Overlay, CLI version, and generator options together in your project. When adopting another release:

1. Download the new base asset without overwriting your previous customized output.
2. Check that every target still matches the intended nodes and that the assumptions behind each customization still hold.
3. Rebuild, lint, and review the differences, including both upstream changes and your Overlay's effects.
4. Repeat response validation and client generation checks as appropriate for your use case.

## References

- [OpenAPI Overlay Specification 1.1.0](https://spec.openapis.org/overlay/v1.1.0.html)
- [Apply Overlays with Redocly CLI](https://redocly.com/docs/cli/guides/apply-overlays)
