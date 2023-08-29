module.exports = {
  async beforeUpdate(event) {
    let { data, where, select, populate } = event.params;
    console.log(JSON.stringify(event));
  },
};