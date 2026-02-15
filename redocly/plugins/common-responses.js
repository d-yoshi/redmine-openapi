module.exports = function commonResponses() {
  return {
    id: 'common-responses',
    decorators: {
      oas3: {
        'inject-common-responses': () => {
          return {
            Operation: {
              leave(operation) {
                operation.responses = operation.responses || {};
                operation.responses['401'] = { $ref: '#/components/responses/Unauthorized' };
                operation.responses['403'] = { $ref: '#/components/responses/Forbidden' };
                operation.responses['412'] = { $ref: '#/components/responses/PreconditionFailed' };
              }
            }
          };
        }
      }
    }
  };
};
