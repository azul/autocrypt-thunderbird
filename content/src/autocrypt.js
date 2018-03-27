var path = require('path')
var level = require('level-browserify')
var autocrypt = require('autocrypt')

module.exports = function () {
  return autocrypt({
    storage: level('autocrypt-test', {valueEncoding: 'json'})
  })
}
