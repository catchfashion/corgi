import { Route, HttpMethod} from '../route';
import { Routes, Namespace } from '../namespace';
import * as LambdaProxy from '../lambda-proxy';
import { flattenRoutes } from '../router';

import * as _ from 'lodash';
import * as _string from 'underscore.string';
import * as Swagger from 'swagger-schema-official';

import JoiToJSONSchema = require("@vingle/joi-to-json-schema");

function deepOmit(obj: any, keysToOmit: string[]) {
  var keysToOmitIndex = _.keyBy(keysToOmit); // create an index object of the keys that should be omitted

  function omitFromObject(obj: any) { // the inner function which will be called recursivley
    return _.transform(obj, function(result, value, key) { // transform to a new object
      if (key in keysToOmitIndex) { // if the key is in the index skip it
        return;
      }

      result[key] = _.isObject(value) ? omitFromObject(value) : value; // if the key is an object run it through the inner function - omitFromObject
    })
  }

  return omitFromObject(obj); // return the inner function result
}

export class SwaggerRoute extends Namespace {
  constructor(path: string, info: Swagger.Info, routes: Routes) {

    const CorsHeaders = function(origin: string) {
      return {
        'Access-Control-Allow-Origin': origin || '',
        'Access-Control-Allow-Headers': [
          'Content-Type',
        ].join(', '),
        'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].join(', '),
        'Access-Control-Max-Age': `${60 * 60 * 24 * 30}`,
      };
    };

    super(path, {
      children: [
        Route.OPTIONS(
          '/', 'CORS Preflight Endpoint for Swagger Documentation API', {},
          async function() {
            return this.json('', 204, CorsHeaders(this.headers.origin));
          }),

        Route.GET('/', 'Swagger Documentation API', {},
          async function() {
            const docGenerator = new SwaggerGenerator();
            const json = docGenerator.generateJSON(info, this.request, routes);
            return this.json(json, 200, CorsHeaders(this.headers.origin));
          }),
      ],
    });
  }
}

export class SwaggerGenerator {
  constructor() {}

  generateJSON(info: Swagger.Info, request: LambdaProxy.Event, routes: Routes): Swagger.Spec {
    const paths: { [pathName: string]: Swagger.Path } = {};

    flattenRoutes(routes).forEach((routes) => {
      const endRoute = (routes[routes.length - 1] as Route);
      const corgiPath = routes.map(r => r.path).join('');
      const swaggerPath = this.toSwaggerPath(corgiPath);

      if (!paths[swaggerPath]) {
        paths[swaggerPath] = {} as Swagger.Path;
      }
      const operation: Swagger.Operation = {
        description: endRoute.desc,
        produces: [
          "application/json; charset=utf-8"
        ],
        parameters: _.flatMap(routes, (route) => {
          if (route instanceof Namespace) {
            // Namespace only supports path
            return _.map(route.params, (schema, name) => {
              const joiSchema = JoiToJSONSchema(schema);
              const param: Swagger.PathParameter = {
                in: 'path',
                name: name,
                description: '',
                type: joiSchema.type,
                required: true
              };
              return param;
            });
          } else {
            return _.map(route.params, (paramDef, name) => {
              if (paramDef.in === "body") {
                const joiSchema = JoiToJSONSchema(paramDef.def);
                const param: Swagger.Parameter = {
                  in: paramDef.in,
                  name: name,
                  description: '',
                  schema: joiSchema,
                  required: true
                };
                return param;
              } else {
                const joiSchema = JoiToJSONSchema(paramDef.def);
                const param: Swagger.Parameter = Object.assign({
                  in: paramDef.in,
                  name: name,
                  description: '',
                }, joiSchema);

                if (paramDef.in === 'path') {
                  param.required = true;
                }

                return param;
              }
            });
          }
        }).map((param) => deepOmit(param, ["additionalProperties", "patterns"])) as any,
        responses: {
          "200": {
            "description": "Success"
          }
        },
        operationId: endRoute.operationId || this.routesToOperationId(corgiPath, endRoute.method),
      };

      switch (endRoute.method) {
        case 'GET': {
          paths[swaggerPath].get = operation;
        } break;
        case 'PUT': {
          paths[swaggerPath].put = operation;
        } break;
        case 'POST': {
          paths[swaggerPath].post = operation;
        } break;
        case 'DELETE': {
          paths[swaggerPath].delete = operation;
        } break;
        case 'OPTIONS': {
          paths[swaggerPath].options = operation;
        } break;
        case 'HEAD': {
          paths[swaggerPath].head = operation;
        } break;
      }
    });


    const swagger: Swagger.Spec = {
      swagger: "2.0",
      info: info,
      // externalDocs?: ExternalDocs;
      host: request.headers["Host"],
      basePath: `/${request.requestContext!.stage}/`,
      schemes: [
        request.headers["X-Forwarded-Proto"]
      ],
      // consumes?: string[];
      produces: [
        "application/json; charset=utf-8",
      ],
      paths,
      tags: [],
      // definitions?: {[definitionsName: string]: Schema };
      // parameters?: {[parameterName: string]: BodyParameter|QueryParameter};
      // responses?: {[responseName: string]: Response };
      // security?: Array<{[securityDefinitionName: string]: string[]}>;
      // securityDefinitions?: { [securityDefinitionName: string]: Security};
    };

    return swagger;
  }

  toSwaggerPath(path: string) {
    return path.replace(/\:(\w+)/g, '{$1}');
  }

  routesToOperationId(path: string, method: HttpMethod) {
    const operation =
      path.split('/').map((c) => {
        if (c.startsWith(':')) {
          return _string.capitalize(c.slice(1));
        } else {
          return _string.capitalize(c);
        }
      }).join('');

    return `${_string.capitalize(method.toLowerCase())}${operation}`;
  }
}
