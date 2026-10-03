/**
 * @param {string} title
 * @param {string[]} possibleTitles
 * @param {string[]} history
 * @param {number} [maxHistory]
 */
export function nextTitleHistoryAfterMark(title, possibleTitles, history, maxHistory = 100) {
  const allAlreadyUsed =
    possibleTitles.length > 0 && possibleTitles.every((t) => history.includes(t));

  if (allAlreadyUsed) {
    return [title].slice(-maxHistory);
  }

  if (!history.includes(title)) {
    return [...history, title].slice(-maxHistory);
  }

  return history.slice(-maxHistory);
}
