module.exports = function removeAdditionalProperties() {
  return {
    id: 'remove-additional-properties',
    decorators: {
      oas3: {
        'remove-additional-properties-false': () => {
          return {
            Schema: {
              leave(schema) {
                if (schema.additionalProperties === false) {
                  delete schema.additionalProperties;
                }
              }
            }
          };
        }
      }
    }
  };
};
