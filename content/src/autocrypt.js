var level = require('level-browserify')
var autocrypt = require('autocrypt')

module.exports = function () {
  return autocrypt({
    storage: level('autocrypt-test5', {valueEncoding: 'json'})
  })
}
