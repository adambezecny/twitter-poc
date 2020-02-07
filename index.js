require('dotenv').config()
const express = require('express')
const bodyParser = require ('body-parser')
const util = require('util')
const request = require('request')
// we must use promisify, without it it does not work properly
const post = util.promisify(request.post)
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

const delay = ms => new Promise(res => setTimeout(res, ms))

const TWITTER_WEBHOOK_ROUTE = '/webhook/twitter'

// https://glitch.com/edit/#!/twitter-autohook-tutorial
const getOauthData = () => {
    return {
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        token: process.env.TWITTER_ACCESS_TOKEN,
        token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        // timestamp: Math.floor((Date.now()) / 1000).toString()
    }    
}

const get_challenge_response = (crc_token, consumer_secret) => {
    hmac = crypto.createHmac('sha256', consumer_secret).update(crc_token).digest('base64')
    return hmac
}

const directMessageHandler = async (msg) => {
    // console.log('direct_message ' + JSON.stringify(msg, null, 2))
    const senderId = msg.message_create.sender_id
    const recipientId = msg.message_create.target.recipient_id
    const message = msg.message_create.message_data.text
    console.log('senderId ' + senderId)
    console.log('recipientId ' + recipientId)
    console.log('message ' + message)

    try {
        console.log('marking as read')
        await markAsRead(msg.id, recipientId) //by common sense senderId should be here but it does not work then
        console.log('sending typing indicator...')
        let response = await indicateTyping(recipientId)////by common sense senderId should be here but it does not work then
        console.log('typing indicator sent!')
        // await delay(5000)
        console.log('responding with echo...')
        // response = await sendDirectMessageText(senderId, recipientId, 'echo: ' + message)
        response = await sendDirectMessageText2(senderId, recipientId, 'echo: ' + message)
        console.log('responded with echo')
        console.log('-------------------------------------')
    } catch (err) {
        console.log('directMessageHandler error' + err.message)
        console.log(err)
    }

}

const markAsRead = async (messageId, recipientId) => {
    const requestConfig = {
      url: 'https://api.twitter.com/1.1/direct_messages/mark_read.json',
      form: {
        last_read_event_id: messageId,
        recipient_id: recipientId
      },
      oauth: getOauthData(),
    }
  
    const response = await post(requestConfig)
    return response
  }

const indicateTyping = async (recipientId,) => {
    const requestConfig = {
      url: 'https://api.twitter.com/1.1/direct_messages/indicate_typing.json',
      form: {
        recipient_id: recipientId
      },
      oauth: getOauthData()
    }
  
    const response = await post(requestConfig)
    return response
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
        return response
    } catch (err) {
        console.log('sendDirectMessageText error ' + err.message)
        console.log(err)
    }
}

const sendDirectMessageText2 = async (recipientId, senderId, text) => {
    const requestConfig = {
        url: 'https://api.twitter.com/1.1/direct_messages/events/new.json',
        oauth: getOauthData(),
        json: {
          event: {
            type: 'message_create',
            sender_id: senderId,
            message_create: {
              target: {
                recipient_id: recipientId,
              },
              message_data: {
                text: text,
              }
            }
          }
        }
      }
    // is user types qr send back also sample quick reply response
    if (text ==='echo: qr') {
        console.log('adding quick reply')
        requestConfig.json.event.message_create.message_data.quick_reply = {
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
    }

    try {
        const response = await post(requestConfig)
        return response
    } catch (err) {
        console.log('sendDirectMessageText2 error ' + err.message)
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