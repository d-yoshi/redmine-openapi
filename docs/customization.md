# Customizing the OpenAPI specification

Use an [OpenAPI Overlay](https://spec.openapis.org/overlay/v1.1.0.html) to define changes in a separate YAML file and generate a customized OpenAPI specification. The build commands in this guide leave the downloaded specification unchanged.

Overlays can define custom-field types for your installation, describe responses modified by plugins, and adjust schemas for a code generator. Applying an Overlay changes the generated OpenAPI specification without transforming the HTTP request or response data exchanged with Redmine.

## Choose a release asset

Choose a [release of this specification](https://github.com/d-yoshi/redmine-openapi/releases) matching your Redmine version. Pin the complete release tag, including the `-rN` revision suffix.

| Asset                 | Difference                                                                                           | Typical use                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `openapi.yaml`        | Omits `additionalProperties: false`, allowing undeclared properties in the affected object schemas.  | General use, including client generation.                                                   |
| `openapi.strict.yaml` | Retains `additionalProperties: false` wherever the source schemas declare it.                        | Detecting undeclared properties in responses, including after upgrades or plugin changes.   |

The two assets otherwise have the same schema constraints, including types, required properties, and `oneOf`. The strict variant does not narrow custom-field types for your installation or adapt schemas to a particular generator. You can apply an Overlay to either asset.

If a Redmine plugin adds response properties, declare those properties in your Overlay when using the strict asset. Object schemas that explicitly allow additional properties, such as maps of custom-field IDs to values, retain that behavior in both assets.

## Prepare the build

The examples below use release `7.0.3-r1` of this specification, Redocly CLI `2.71.0`, and Node.js 24. Replace the release tag with the one for your Redmine version. You can run these commands without cloning this repository.

```sh
mkdir redmine-api-custom
cd redmine-api-custom

REDMINE_SPEC_TAG=7.0.3-r1
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

Use the standalone configuration above for these examples. The repository's build configuration includes a decorator that removes `additionalProperties: false` for distribution; using the repository configuration could remove constraints you intended to keep.

Choose an example below and save it as `custom.overlay.yaml`. Each example is independent.

## Example: single-valued custom fields

Suppose your Redmine installation uses only single-valued custom fields whose API values are strings or `null`. The following Overlay narrows the shared custom-field response value schema:

```yaml
overlay: 1.1.0
info:
  title: Single-valued custom-field responses
  version: 1.0.0
actions:
  - target: $.components.schemas.custom_field_response_value_type.oneOf
    remove: true
  - target: $.components.schemas.custom_field_response_value_type
    update:
      type: string
      nullable: true
```

The `value` property in `custom_field_value` references `custom_field_response_value_type`. Every response schema that uses `custom_field_value` therefore uses the customized value schema. Validators using the customized specification reject array values for that property. To use different value types for different fields or resource types, define separate schemas and reference them from the corresponding response schemas.

The request schemas use a separate value component, `custom_field_request_value_type`, which this Overlay leaves unchanged. Both the `custom_fields` array of field objects and the `custom_field_values` map keyed by field ID reference that component. Customize it separately to change the value schema for both request formats.

Define custom-field schemas to match the JSON values actually returned by Redmine. A numeric custom field can return a JSON string such as `"42"`; declaring the value as `integer` in the specification does not convert that JSON string to a number.

## Example: a plugin changes a response type

Suppose a Redmine plugin changes the `description` property in issue responses from a string to an object containing `plain` and `html` strings, while still allowing `null`. The following Overlay replaces the schema for that response property in both issue detail and list responses:

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

Replace the example's object structure with the JSON structure your plugin actually returns. Removing the existing schema for the `description` response property first prevents constraints from the original type from remaining in the replacement schema. The `issue` and `issue.summary` schemas still require the `description` property; request schemas remain unchanged.

You can also use an Overlay to add response properties or change which values can be `null` and which properties are required. Update every response schema affected by the plugin, including separate list and detail schemas.

## Example: a generator cannot handle custom-field unions

Before modifying the specification for code generation, check whether your generator has suitable configuration options or type mappings. If your generator cannot handle the `oneOf` constraints on custom-field values, the following Overlay removes those constraints:

```yaml
overlay: 1.1.0
info:
  title: Unconstrained custom-field values for generation
  version: 1.0.0
actions:
  - target: $.components.schemas.custom_field_response_value_type.oneOf
    remove: true
  - target: $.components.schemas.custom_field_request_value_type.oneOf
    remove: true
```

Removing these two `oneOf` constraints leaves both shared value components as `{}`, allowing any JSON value. Generated types depend on the generator and target language; inspect the output before using the generated client.

Other unions in the specification remain unchanged and may need separate adjustments for your generator. Keep a separate specification with the custom-field value constraints intact for response validation.

## Build and verify

Build `openapi.custom.yaml` with your chosen Overlay, then lint the generated specification:

```sh
npx --yes @redocly/cli@2.71.0 bundle openapi.base.yaml \
  --config redocly.yaml \
  --overlay custom.overlay.yaml \
  --output openapi.custom.yaml

npx --yes @redocly/cli@2.71.0 lint openapi.custom.yaml \
  --config redocly.yaml
```

Use `openapi.custom.yaml` as the input to your generator or response validator. Keep `openapi.base.yaml` unchanged so you can compare the customized specification with the downloaded base.

Redocly's lint command checks the generated OpenAPI specification against configured rules. Linting does not verify that the schemas match responses from your installation or that your generator produces usable client code. Validate representative API responses against the customized schemas, and generate and compile your client with your chosen generator and options.

When writing or combining Overlays:

- Overlay actions run in the listed order. An `update` action merges objects and appends array elements. To replace an entire schema or an array such as `required` or `oneOf`, first remove the existing schema or array, then add the replacement by updating the parent object.
- Write `target` JSONPath expressions against the bundled OpenAPI specification. Use bracket notation for component names containing a dot, such as `issue.summary`, as shown in the plugin example.
- If an action's `target` matches no nodes, the action succeeds without making a change. Compare `openapi.custom.yaml` with `openapi.base.yaml` to confirm that the intended changes were applied.
- When you specify multiple `--overlay` options, Redocly applies the Overlays in that order. Review the combined result, especially if one Overlay narrows a type and another relaxes the same constraint.

## Update the base specification

Keep the Overlay and a record of the base release tag, asset filename, CLI version, and generator options together in your project. When adopting another release:

1. Keep copies of your current base and customized specifications before downloading the new base asset.
2. Check that every Overlay action's `target` still matches the intended nodes and that each customization still matches your installation and generator requirements.
3. Rebuild and lint the customized specification. Compare the new output with both the new base and your previous customized specification.
4. Recheck representative API responses against the new customized schemas, then regenerate and compile your client as needed.

Component names and references can affect generated model names and code structure even when the accepted JSON values remain the same.

## References

- [OpenAPI Overlay Specification 1.1.0](https://spec.openapis.org/overlay/v1.1.0.html)
- [Apply Overlays with Redocly CLI](https://redocly.com/docs/cli/guides/apply-overlays)
