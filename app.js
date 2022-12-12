/**
 * Projet FYC 2022-2023
 * Autheurs : Valentin Croset & Léo terras & nicolas Rossat & koray Akyurek 
 */
import express from 'express'
import openApiValidator from 'express-openapi-validator'
import helmet from 'helmet'
import path from 'path'
import rateLimit from 'express-rate-limit'
import wsUtils from './utils.cjs'

var app = express()

wsUtils.setup(app)
app.use(helmet())
app.disable('x-powered-by')

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: true
}))

app.use('/doc', express.static(path.join('doc.yaml')))

// End points validator
app.use(openApiValidator.middleware({
    apiSpec: './doc.yaml',
    validateRequests: {allowUnknownQueryParameters: true}
}))

// Routes

// app.set('trust proxy', NB_OF_PROXY) if you use proxy or load balancer 
if (process.env.DEV) {
    app.get('/ip', (request, response) => response.send(request.ip))
}

// Main error handler
app.use(wsUtils.errorHandler)

var port = process.env.PORT || 3000
app.listen(port)
console.log('WS projet FYC started on port ' + port)