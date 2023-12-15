function arrayDifference(arr1, arr2) {
  const difference = [];

  for (const item of arr1) {
    if (!arr2.includes(item)) {
      difference.push(item);
    }
  }

  for (const item of arr2) {
    if (!arr1.includes(item)) {
      difference.push(item);
    }
  }

  return difference;
}


module.exports = arrayDifference;