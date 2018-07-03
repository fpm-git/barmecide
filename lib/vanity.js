
const AsciiTable = require('ascii-table');

/**
 * Provides vanity logging functions, etc.
 */
module.exports = {

    /**
     * Handles performing a truncation from the left side, generating an output string of the
     * specified length, based upon the given text. When the source text exceeds the desired
     * length limit, the given leading string is applied (or '...' by default), and the text
     * is truncated appropriately.
     *
     * If the source text is below the length limit, then it is simply returned as-is.
     *
     * @param {String} text - The text which should be truncated, if necessary.
     * @param {number} length - The maximum length allowed before truncation becomes necessary.
     * @param {String} [lead='...'] - The characters which should be used to prefix a truncated
     * string.
     *
     * @returns {String} A string fitting the desired length criteria, having been truncated
     * if it was necessary to meet this limit.
     */
    truncateLeft(text, length, lead = '...') {
        return (text.length < length)
            ? text
            : (lead + text.substr(text.length - length + lead.length)).substring(0, length);
    },

    /**
     * A simple little helper function used to render out a summary of loaded hook info in an
     * appropriate form, typically tabular if enough space exists. This makes ensuring things
     * have loaded properly fairly simple with just a cursory glance, and saves space over the
     * previous output format used by Marlinspike.
     *
     * This method does some hackery to deal with different console sizes. I wish it would be
     * simpler/less messy, but it performs no critical operation and serves solely for simple
     * debugging purposes.
     *
     * @param {Object[]} hooksInfo - List of hook description objects, as found by the loader.
     * @param {boolean} [useTrunc=false] - Whether or not truncation should be used for names
     * where there is not enough space to list full values. Not currently used.
     *
     * @returns {String} The rendered hook information table.
     */
    renderLoadInformation(hooksInfo, _useTrunc = false) {
        // Setup our constant short and long row names, which are selected against based on the output
        // column count.
        const SHORT_ROW_NAMES = ['NAME', 'STAT', 'MDL', 'SVC', 'CTL', 'CFG'];
        const LONG_ROW_NAMES = ['Name', 'Status', 'Models', 'Services', 'Controllers', 'Config'];

        // Extract the number of columns, defaulting to an insanely high value in cases where we've no
        // set limit (as we shouldn't bother limiting line-length in this case).
        const numColumns = process.stdout.columns || Number.MAX_SAFE_INTEGER;

        // Select the headings to actually use based on column size.
        const rowHeadings = (numColumns < 80)
            // If we've a non-zero number of columns which is less than 80, use the short names.
            ? SHORT_ROW_NAMES
            // Otherwise, use the long names. This includes cases where the count of columns could not be retrieved.
            : LONG_ROW_NAMES;

        // Determine the max length of any hook-name cell. We'll use either the length of our
        // longest loaded hook name, or the length of the name heading, whichever is greater.
        const maxNameLen = Math.max(
            hooksInfo.reduce((acc, hook) => Math.max(acc, hook.globalEntry.name.length), 0),
            rowHeadings[0].length,
        );

        // Create a dummy table to calculate the max length of our rows.
        // We'll do this so we can perform any smart truncation as necessary (I wish ascii-table provided this by default–feels shoddy adding it here </3).
        const dummy = new AsciiTable();
        dummy.addRow(new Array(maxNameLen + 1).join('X'), ...rowHeadings.slice(1));
        // Calculate the length based on our rendered dummy table.
        const dummyLen = (dummy.render().length - 2) / 3;

        // Calculate our max hook name string limit.
        const truncLimit = maxNameLen - (dummyLen - numColumns);

        // Create a new ASCII table instance.
        const table = new AsciiTable();
        // Apply our headings, and border styles.
        table.setHeading(...rowHeadings).setBorder('|', '-', '-', '-');
        // Apply right-alignment for each column but the name.
        [1, 2, 3, 4, 5].forEach(idx => table.setAlign(idx, AsciiTable.RIGHT));
        // Add all our row items.
        hooksInfo.forEach(hook => {
            table.addRow(
                this.truncateLeft(hook.globalEntry.name, truncLimit),
                hook.status,
                Object.values(hook.items.models).length,
                Object.values(hook.items.services).length,
                Object.values(hook.items.controllers).length,
                Object.values(hook.items.config).length,
            );
        });

        return table.render();
    },

};
