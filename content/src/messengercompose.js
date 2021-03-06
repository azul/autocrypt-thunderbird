var MimeBuilder = require('emailjs-mime-builder')
var crypto = require('crypto')
var base64 = require('base64-js')
var openpgp = require('openpgp')

var send = require('./send')
var account = require('./email')
var getAuthor = require('./author')
var autocrypt = require('./autocrypt')()

var Cc = self.Components.classes
var Ci = self.Components.interfaces
var Cu = self.Components.utils

Cu.import("resource:///modules/mailServices.js");

var gTxtConverter = Cc["@mozilla.org/txttohtmlconv;1"].createInstance(Ci.mozITXTToHTMLConv)
var convFlags = Ci.mozITXTToHTMLConv.kEntities

var ready = false

window.addEventListener('compose-send-message', onSendMessage, true);
window.addEventListener('load', function (e) {
  startup();
}, false);

function onerror (err) {
  if (err) console.error(err)
}

function encrypt (fromEmail, toEmail, plainText, cb) {
  while (!ready) {} // once we have the key ready, lets do this
  autocrypt.getUser(fromEmail, function (err, from) {
    if (err) return cb(err)
    autocrypt.getUser(toEmail, function (err, toUser) {
      if (err) return cb(err)
      var options = {
        data: plainText,
        publicKeys: openpgp.key.read(base64.toByteArray(toUser.keydata)).keys,
        privateKeys: openpgp.key.read(base64.toByteArray(from.privateKey)).keys
      }
      openpgp.encrypt(options).then(function (cipherText) {
        cb(null, cipherText)
      })
    })
  })
}

function onSendMessage (event) {
  var identity = getCurrentIdentity()
  let msgSend = Cc['@mozilla.org/messengercompose/send;1'].createInstance(Ci.nsIMsgSend);
  let progress = Cc["@mozilla.org/messenger/progress;1"].createInstance(Ci.nsIMsgProgress);

  var currentMessage = self.gMsgCompose.compFields

  var fromEmail = getAuthor(account.getEmail(identity))
  var toEmail = getAuthor(currentMessage.to)
  var body = gMsgCompose.editor.document.body.textContent
  // lets try to encrypt this
  encrypt(fromEmail, toEmail, body, function (err, cipherText) {
    if (err) onerror(err)
    if (cipherText) {
      // halalujah, it can be encrypted
      var cryptoBoundary = crypto.randomBytes(16).toString('base64')
      var contentType =`multipart/encrypted;protocol="application/pgp-encrypted";boundary="${cryptoBoundary}"`
      currentMessage.deleteHeader('Content-Transfer-Encoding')
      currentMessage.deleteHeader('Content-Type')
      currentMessage.setHeader('Content-Type', contentType)

      var mimeMessage = "This is an OpenPGP/MIME encrypted message (RFC 4880 and 3156)\r\n" +
      "--" + cryptoBoundary + "\r\n" +
      "Content-Type: application/pgp-encrypted\r\n" +
      "Content-Description: PGP/MIME version identification\r\n" +
      "\r\n" +
      "Version: 1\r\n" +
      "\r\n" +
      "--" + cryptoBoundary + "\r\n" +
      "Content-Type: application/octet-stream; name=\"encrypted.asc\"\r\n" +
      "Content-Description: OpenPGP encrypted message\r\n" +
      "Content-Disposition: inline; filename=\"encrypted.asc\"\r\n"
      + "\r\n";
      mimeMessage += cipherText.data
    }
    // ok send the message
    autocrypt.generateAutocryptHeader(fromEmail, function (err, autocryptHeader) {
      if (err) onerror(err)
      if (autocryptHeader) currentMessage.setHeader('Autocrypt', autocryptHeader)

      var date = new Date()
      var body = "Date: " + date.toUTCString() + '\r\n' + currentMessage.buildMimeText() + '\r\n' + mimeMessage
      var params = {
        identity: identity,
        to: toEmail,
        from: fromEmail,
        subject: currentMessage.subject,
      }
      send(params, body, function (err) {
        if (err) onerror(err)
        gMsgCompose.CloseWindow()
      })
    })
  })

  event.stopPropagation()
  event.preventDefault()
  return false
}


function startup () {
  var identity = getCurrentIdentity()
  var email = account.getEmail(identity)

  function done (err) {
    if (err) return onerror(err)
    // we're ready to send mail!
    ready = true
    return
  }

  autocrypt.getUser(email, function (err, user) {
    // if the user is not found generate the key
    if (err) return generateKey(email, done)
    done(null)
  })
}

function unarmor (armored) {
  var unarmored = openpgp.armor.decode(armored)
  var data = unarmored.data
  return base64.fromByteArray(data)
}

function generateKey (email, cb) {
  // TODO: relate email with id in autocrypt and use that instead.
  // var id = `${crypto.randomBytes(24).toString('hex')}@autocrypt.org`
  openpgp.generateKey({
    userIds: [{ name: ' ', email: email }],
    numBits: 3072
  }).then((key) =>  {
    var publicKey = unarmor(key.publicKeyArmored)
    var privateKey = unarmor(key.privateKeyArmored)
    autocrypt.createUser(email, {publicKey, privateKey}, cb)
  })
}
