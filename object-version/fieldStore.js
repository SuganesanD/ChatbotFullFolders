const fieldStore = {
  filterFieldsByObject: {},

  get allSelectedFields() {
    const allFields = Object.values(this.filterFieldsByObject).flat();
    return [...new Set(allFields.map(f => f.toLowerCase()))];
  }
};

module.exports = { fieldStore };