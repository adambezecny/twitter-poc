require('dotenv').config()
const express = require('express')
const bodyParser = require ('body-parser')
const request = require('request')
const port = 3000
const crypto = require('crypto')
const twitterWebhooks = require('twitter-webhooks')
const Twit = require('twit')
const twitterClient = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

let _twitter_time_minus_local_time_ms = 0

const delay = ms => new Promise(res => setTimeout(res, ms))

const TWITTER_WEBHOOK_ROUTE = '/webhook/twitter'

const updateClockOffsetFromResponse =  (resp) => {
    if (resp && resp.headers && resp.headers.date &&
        new Date(resp.headers.date).toString() !== 'Invalid Date'
    ) {
      const twitterTimeMs = new Date(resp.headers.date).getTime()
      _twitter_time_minus_local_time_ms = twitterTimeMs - Date.now()
    }
}

const getOauthData = () => {
    const oauth_ts = Date.now() + _twitter_time_minus_local_time_ms;

    return {
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        token: process.env.TWITTER_ACCESS_TOKEN,
        token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        timestamp: Math.floor(oauth_ts/1000).toString(),
    }    
}

const get_challenge_response = (crc_token, consumer_secret) => {
    hmac = crypto.createHmac('sha256', consumer_secret).update(crc_token).digest('base64')
    return hmac
}

const directMessageHandler = async (msg) => {
    console.log('direct_message ' + JSON.stringify(msg, null, 2))
    const senderId = msg.message_create.sender_id
    const recipientId = msg.message_create.target.recipient_id
    const message = msg.message_create.message_data.text
    console.log('senderId ' + senderId)
    console.log('recipient_id ' + recipientId)
    console.log('message ' + message)

    console.log('responding with echo...')
    await sendTypingIndicator(senderId)
    await delay(4000)
    const response = await sendDirectMessageText(senderId, recipientId, 'echo: ' + message)
    updateClockOffsetFromResponse(response)
    console.log('responded with echo...')
}

const sendTypingIndicator = async (recipientId) => {

    try {

        const requestConfig = {
            url: 'https://api.twitter.com/1.1/direct_messages/indicate_typing.json',
            form: {
              recipient_id: recipientId,
            },
            oauth: getOauthData(),
          }    

        const response = await request.post(requestConfig)  
        console.log('sendTypingIndicator done ' + JSON.stringify(response))
    } catch (err) {
        console.log('sendTypingIndicator error ' + err.message)
        console.log(err)
    }    
}

// see https://developer.twitter.com/en/docs/direct-messages/sending-and-receiving/api-reference/new-event
const sendDirectMessageText = async (recipientId, senderId, text) => {
    // https://developer.twitter.com/en/docs/direct-messages/sending-and-receiving/guides/message-create-object
    const payload = {
        event: {
            type: 'message_create',
            message_create: {
                target: {
                    recipient_id: recipientId
                },
                sender_id: senderId,
                message_data: {
                    text: text
                }
            }
        }
    }
    // is user types qr send back also sample quick reply response
    if (text ==='echo: qr') payload.event.message_create.message_data.quick_reply = {
        type: 'options',
        options: [
          {
            label: 'Red Bird',
            description: 'A description about the red bird.',
            metadata: 'external_id_1'
          },
          {
            label: 'Blue Bird',
            description: 'A description about the blue bird.',
            metadata: 'external_id_2'
          }
        ]
    }

    try {
        const response = await twitterClient.post('direct_messages/events/new', payload)
        // console.log('sendDirectMessageText done ' + JSON.stringify(response))
    } catch (err) {
        console.log('sendDirectMessageText error ' + err.message)
        console.log(err)
    }
}

const unregisterWebhook = async(expressApp, webhookId) => {
    console.log('unregistering twitter webhook...')
    const userActivityWebhook = twitterWebhooks.userActivity({
        serverUrl: process.env.TWITTER_WEBHOOK_URL,
        route: TWITTER_WEBHOOK_ROUTE,
        consumerKey: process.env.TWITTER_CONSUMER_KEY,
        consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        environment: process.env.TWITTER_WEBHOOK_ENV,
        app: expressApp
    })

    await userActivityWebhook.unregister({
        webhookId: webhookId
    })
    console.log('twitter webhook unregistered')
}

// run only once when registering webhook!
const registerWebhook = async (expressApp) => {
    console.log('registering twitter webhook...')
    const userActivityWebhook = twitterWebhooks.userActivity({
        serverUrl: process.env.TWITTER_WEBHOOK_URL,
        route: TWITTER_WEBHOOK_ROUTE,
        consumerKey: process.env.TWITTER_CONSUMER_KEY,
        consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        environment: process.env.TWITTER_WEBHOOK_ENV,
        app: expressApp
    })

    try {

        const webhooks = await userActivityWebhook.getWebhook()

        if (webhooks.length === 0) {
            console.log('no webhook found, registering new one')
            const webhookInfo = await userActivityWebhook.register()
            console.log('twitter webhook registered!')
            console.log(JSON.stringify(webhookInfo))
        } else {
            console.log('following webhook found ' + JSON.stringify(webhooks))
            console.log('unregistering')
            await unregisterWebhook(app, webhooks[0].id)
            console.log('registering new webhook')
            const webhookInfo = await userActivityWebhook.register()
            console.log('twitter webhook registered!')
            console.log(JSON.stringify(webhookInfo))
        }

        console.log('checking subscription...')
        const isSubscribed = await userActivityWebhook.isSubscribed({
            userId: process.env.TWITTER_USER_ID,
            accessToken: process.env.TWITTER_ACCESS_TOKEN,
            accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
        })
        console.log('isSubscribed ' + isSubscribed)
        if (isSubscribed === false) {
            console.log('subscribing to user activity...')
            const userActivity = await userActivityWebhook.subscribe({
                userId: process.env.TWITTER_USER_ID,
                accessToken: process.env.TWITTER_ACCESS_TOKEN,
                accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
            })

            console.log('subscribed to user activity!')
            console.log(userActivity)

            console.log('registering direct messages handlers...')
        
            userActivity.on ('direct_message', directMessageHandler)
    
            console.log('direct_message handlers registered!')            

        } else {
            console.log('skipping subscription creation')
        }

    } catch(err) {
        console.log('registerWebhook error')
        console.log(err)
    }
}

const app = express()
app.use(bodyParser.json())

app.get('/', (req, res) => res.send('Hello Twitter!'))

app.get(TWITTER_WEBHOOK_ROUTE, (req, res) => {
    const crc_token = req.query.crc_token
    console.log(TWITTER_WEBHOOK_ROUTE + ' GET handler called ' + crc_token)
    if (crc_token) {
        const hash = get_challenge_response(crc_token, process.env.TWITTER_CONSUMER_SECRET)
    
        res.status(200);
        res.send({
          response_token: 'sha256=' + hash
        })
      } else {
        res.status(400);
        res.send('Error: crc_token missing from request.')
      }    
})

app.listen(port, () => console.log(`Twitter sample app listening on port ${port}!`))

registerWebhook(app) // run only once when registering webhook!