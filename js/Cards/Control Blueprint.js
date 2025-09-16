{
    // The type of HTML element to create.
    type: 'text' | 'color' | 'checkbox' | 'range' | 'select' | 'button' | 'list',

    // (Optional) The text label that appears next to the control.
    label: 'Your Label Here',

    // (For data-bound controls) The key in the card's `data` object.
    // The modal will use this to get the initial value.
    key: 'title', 

    // (For 'select' or 'radio' types) An array of options to display.
    // Each option is an object with a 'name' (for display) and a 'value'.
    options: [ { name: 'Option 1', value: 'opt1' }, { name: 'Option 2', value: 'opt2' } ],

    // The function from the card to call when the control's value changes.
    // The modal will pass the new value as the first argument.
    onChange: (newValue, cardInstance) => { /* card's logic here */ },

    // (For 'button' type) The function from the card to call when clicked.
    onClick: (cardInstance) => { /* card's logic here */ },

    // (For 'list' type) Defines how to render a list of items from card.data.
    listConfig: {
        source: 'files', // The key in card.data that holds the array.
        titleKey: 'fileName', // The key in each item object for its title.
        actions: [ /* An array of button Control Objects for each list item */ ]
    }
}