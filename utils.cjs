const PARAM_NAME_CHARS = '[a-zA-Z0-9/_]'
const DEFAULT_PARAM_VALUE = { nbMin: 1, nbMax: 1, regex: /.+/, symbols: [] }

function applyDefaultConf(obj) {
    return Object.keys(obj).reduce((acc, k) => ({ ...acc, [k]: { ...DEFAULT_PARAM_VALUE, ...obj[k] } }), {})
}

const OPERATORS = applyDefaultConf({
    'eq': {
        compare: (a, b) => a == b,
        symbols: ['==', '='],
        sql: '='
    },
    'ne': {
        compare: (a, b) => a != b,
        symbols: ['!=', '<>'],
        sql: '<>'
    },
    'lte': {
        compare: (a, b) => a <= b,
        symbols: ['<='],
        sql: '<='
    },
    'gte': {
        compare: (a, b) => a >= b,
        symbols: ['>='],
        sql: '>='
    },
    'lt': {
        compare: (a, b) => a < b,
        symbols: ['<'],
        sql: '<'
    },
    'gt': {
        compare: (a, b) => a > b,
        symbols: ['>'],
        sql: '>'
    },
    'in': {
        compare: (a, b) => b.some(el => el == a),
        nbMax: 999,
        sql: (p, values) => `${mysql.escapeId(p)} IN (${mysql.escape(values)})`
    },
    'nin': {
        compare: (a, b) => b.every(el => el != a),
        nbMax: 999,
        sql: (p, values) => `${mysql.escapeId(p)} NOT IN (${mysql.escape(values)})`
    },
    'exists': {
        compare: (a, b) => [null, undefined, ''].includes(a) != b,
        regex: /^(false|true)$/,
        sql: (p, bool) => `${mysql.escapeId(p)}${bool ? ' IS NOT NULL' : ' IS NULL'}`
    },
    'bt': {
        compare: (a, b) => b[0] < a && a < b[1],
        nbMin: 2,
        nbMax: 2,
        sql: (p, [v1, v2]) => [`${mysql.escapeId(p)} BETWEEN ${mysql.escape(v1)} AND ${mysql.escape(v2)}`]

    },
    'startsWith': {
        compare: (a, b) => (a ?? '').toString().toLowerCase().startsWith((b ?? '').toString().toLowerCase()),
        sql: (p, v) => `${mysql.escapeId(p)} LIKE ${mysql.escape(v + '%')}`
    },
    'endsWith': {
        compare: (a, b) => (a ?? '').toString().toLowerCase().endsWith((b ?? '').toString().toLowerCase()),
        sql: (p, v) => `${mysql.escapeId(p)} LIKE ${mysql.escape('%' + v)}`
    },
    'contains': {
        compare: (a, b) => (a ?? '').toString().toLowerCase().includes((b ?? '').toString().toLowerCase()),
        sql: (p, v) => `${mysql.escapeId(p)} LIKE ${mysql.escape('%' + v + '%')}`
    }
})

const SYMBOLS = Object.keys(OPERATORS).reduce((acc, key) => {
    OPERATORS[key].symbols.forEach(s => acc[s] = key)
    return acc
}, {})

const QUERY_REGEX = new RegExp(`^(\\$?${PARAM_NAME_CHARS}+)([.[ -](${Object.keys(OPERATORS).join('|')})[.\\] -=]=?|${Object.keys(SYMBOLS).join('|')})(.*)$`)

const CUSTOM_FILTERS = applyDefaultConf({
    '$select': { nbMax: 999 },
    '$orderby': { nbMax: 2, regex: /^[^,]+(,(asc|desc))?$/ },
    '$count': { regex: /^\d+$/ },
    '$page': { regex: /^\d+$/ }
})

class NotFound extends Error {
    constructor(...params) {
        super(...params)
        this.name = 'NotFound';
    }
}

class BadRequest extends Error {
    constructor(...params) {
        super(...params)
        this.name = 'BadRequest';
    }
}

class Unauthorized extends Error {
    constructor(...params) {
        super(...params)
        this.name = 'Unauthorized';
    }
}

class Forbidden extends Error {
    constructor(...params) {
        super(...params)
        this.name = 'Forbidden';
    }
}

class ValidationError extends Error {
    constructor(validationErrors) {
        super();
        this.name = "JsonSchemaValidationError";
        this.validationErrors = validationErrors;
    }
}

const ERRORS = {
    NotFound,
    BadRequest,
    Unauthorized,
    Forbidden
}

const ERROR_CODES = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    406: 'NOT_ACCEPTABLE',
    413: 'REQUEST_ENTITY_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    500: 'INTERNAL_SERVER_ERROR',
}

function boolCaster(val) {
    [true, false].forEach(bool => {
        if (val === bool.toString()) {
            val = bool
        }
    })
    return val
}

function queryParser(str) {
    return (str || '').split('&').filter(x => x).reduce((acc, chunk) => {
        var match = decodeURIComponent(chunk).match(QUERY_REGEX)
        if (!match) return { ...acc, [chunk]: '' }
        var key = match[1]
        var ope = match[3] || SYMBOLS[match[2]]
        var value = match[4]
        return { ...acc, [key]: (acc[key] || []).concat({ ope, value }) }
    }, {})
}

function isValidValue(val, conf) {
    if (!(typeof val == 'string' && conf.regex.test(val))) return false
    var nbValues = val.split(',').length
    return conf.nbMin <= nbValues && nbValues <= conf.nbMax
}

function queryValidator(req, res, next) {
    var badParams = Object.keys(req.query).reduce((acc, param) => {
        var paramLC = param.toLowerCase()
        if (!Array.isArray(req.query[param]) || !req.query[param].length) {
            acc.push(param)
        } else if (Object.keys(CUSTOM_FILTERS).includes(paramLC)) {
            if (req.query[param].length == 1 && req.query[param][0].ope == 'eq' && isValidValue(req.query[param][0].value, CUSTOM_FILTERS[paramLC])) {
                req.query[paramLC] = CUSTOM_FILTERS[paramLC].nbMax > 1 ? req.query[param][0].value.split(',') : req.query[param][0].value
                if (paramLC != param) delete req.query[param]
            } else {
                acc.push(param)
            }
        } else if (new RegExp(`^${PARAM_NAME_CHARS}+$`).test(param)) {
            req.query[param].forEach((filter, i) => {
                var v = Object.keys(OPERATORS).includes(filter.ope) && isValidValue(filter.value, OPERATORS[filter.ope])
                if (v) {
                    if (OPERATORS[filter.ope].nbMax > 1) {
                        req.query[param][i].value = filter.value.split(',').map(boolCaster)
                    } else {
                        req.query[param][i].value = boolCaster(filter.value)
                    }
                } else {
                    acc.push(`${param}[${filter.ope}]`)
                }
            })
        } else {
            acc.push(param)
        }
        return acc
    }, [])
    if (badParams.length) {
        res.status(400).json({
            errorCode: ERROR_CODES[400],
            message: `Invalid filters : ${badParams.join(', ')}`
        })
    } else {
        next()
    }
}

function responseExtender(req, res, next) {
    res.sendNotFound = msg => {
        res.status(404).json({
            errorCode: ERROR_CODES[404],
            message: msg || 'Resource not found'
        })
    }
    res.sendBadRequest = msg => {
        res.status(400).json({
            errorCode: ERROR_CODES[400],
            message: msg || 'Bad Request'
        })
    }
    res.sendUnauthorized = msg => {
        res.status(401).json({
            errorCode: ERROR_CODES[401],
            message: msg || 'Unauthorized'
        })
    }
    res.sendForbidden = msg => {
        res.status(403).json({
            errorCode: ERROR_CODES[403],
            message: msg || 'Forbidden'
        })
    }
    next()
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        next(err)
    } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        res.sendBadRequest('Invalid JSON')
    } else if (err instanceof NotFound) {
        res.sendNotFound(err.message)
    } else if (err instanceof BadRequest) {
        res.sendBadRequest(err.message)
    } else if (err instanceof Unauthorized) {
        res.sendUnauthorized(err.message)
    } else if (err instanceof Forbidden) {
        res.sendForbidden(err.message)
    } else if (Object.values(OpenApiValidator.error).some(e => err?.constructor?.name == e.name)) {
        res.status(err.status || 500).json({
            errorCode: ERROR_CODES[err.status || 500] || err.status,
            message: err.status == 400 ? err.errors : err.message
        })
    } else {
        console.trace(err)
        res.status(err.customCode && err.status ? err.status : 500).json({
            errorCode: err && err.customCode ? err.customCode : ERROR_CODES[err.customCode && err.status ? err.status : 500],
            message: err && err.customCode && err.message ? err.message : 'Internal Server Error'
        })
    }
}

function consoleBeautifier() {
    ["log", "warn", "error", "info"].forEach(function (e) { var o = console[e].bind(console); console[e] = function () { o.apply(console, [`[${new Date(1000 * ((new Date).getTime() / 1000 - 60 * (new Date).getTimezoneOffset())).toISOString()}]`, `[${e.toUpperCase()}]`].concat(Array.from(arguments))) } });
}

function setup(app) {
    app.set('query parser', queryParser)
    app.use(queryValidator, responseExtender)
    consoleBeautifier()
}

module.exports = {
    setup,
    queryParser,
    queryValidator,
    errorHandler,
    consoleBeautifier,
    ERRORS,
    ERROR_CODES
}