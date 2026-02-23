async function test() {
    const token = 'e48bc0b4-8865-475b-9791-c7de5bfe8e90';
    const url = 'https://api.zenvia.com/v2/contacts';

    // Test GET
    const resGet = await fetch(url + '?channels.mobile=5541998902754', {
        headers: { 'X-API-TOKEN': token }
    });
    const dataGet = await resGet.json();
    console.log('Contacts GET Response:', JSON.stringify(dataGet, null, 2));

    // Test POST Validation
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-TOKEN': token
        },
        body: JSON.stringify({
            firstName: "Test Contact",
            channels: {
                mobile: "5541998902754"
            }
        })
    });

    const data = await res.json();
    console.log('Contacts POST Response:', data);
}
test();
