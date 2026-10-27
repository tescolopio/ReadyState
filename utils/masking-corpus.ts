/**
 * Realistic household descriptions for testing `maskInput`. `pii` lists every
 * value that must not reach the server; `keep` lists details the simulation
 * needs, which must survive masking. All people, numbers and addresses are
 * fictional (555 numbers, example.com emails).
 */
export interface MaskingCase {
  text: string;
  pii: string[];
  keep?: string[];
}

export const MASKING_CORPUS: MaskingCase[] = [
  {
    text: "It's me, my wife Priya and our two kids, Linh (8) and Bao (5). Priya is type 1 diabetic and her insulin is in the fridge.",
    pii: ["Priya", "Linh", "Bao"],
    keep: ["type 1 diabetic", "insulin", "fridge"],
  },
  {
    text: "Tim Escolopio here. We live at 4512 W Elm Ave Apt 3, Denver CO 80203. Call me at (303) 555-0142 or tim.e@example.com.",
    pii: ["Tim", "Escolopio", "4512 W Elm Ave", "Denver", "80203", "(303) 555-0142", "tim.e@example.com"],
    keep: ["CO"],
  },
  {
    text: "Our dog Max is a 90 lb shepherd and he panics during thunder. We also have two cats, Luna and Milo.",
    pii: ["Max", "Luna", "Milo"],
    keep: ["90 lb shepherd", "thunder"],
  },
  {
    text: "The Nguyens next door have a generator and their daughter Mai is a nurse.",
    pii: ["Nguyens", "Mai"],
    keep: ["generator", "nurse"],
  },
  {
    text: "My husband Darnell uses a CPAP every night and my mother-in-law Gloria needs her oxygen concentrator.",
    pii: ["Darnell", "Gloria"],
    keep: ["CPAP", "oxygen concentrator"],
  },
  {
    text: "Household: me (Aisha), my son Omar, 14, and my elderly father Yusuf who uses a walker. Apartment on the 6th floor, no elevator backup.",
    pii: ["Aisha", "Omar", "Yusuf"],
    keep: ["walker", "6th floor"],
  },
  {
    text: "We're in a farmhouse just outside of Greeley, Colorado with 40 chickens and two goats named Pepper and Salt.",
    pii: ["Greeley", "Pepper", "Salt"],
    keep: ["Colorado", "40 chickens"],
  },
  {
    text: "My partner Sam and I rent at 22 Harbor View Rd, Portland ME 04101. Neighbor's number is 207-555-0199.",
    pii: ["Sam", "22 Harbor View Rd", "Portland", "04101", "207-555-0199"],
  },
  {
    text: "I live alone with my cat Biscuit. I take warfarin daily and have about 10 days left.",
    pii: ["Biscuit"],
    keep: ["warfarin", "10 days"],
  },
  {
    text: "Family of five: my wife Mei Lin, our kids Kai, Hana and Jun, plus my grandmother Sachiko who has dementia.",
    pii: ["Mei Lin", "Kai", "Hana", "Jun", "Sachiko"],
    keep: ["dementia"],
  },
  {
    text: "We have a 10000 mAh power bank, a 12000 BTU propane heater, and 20 gallons of water stored in the garage.",
    pii: [],
    keep: ["10000 mAh", "12000 BTU", "20 gallons"],
  },
  {
    text: "My daughter Siobhan O'Connor is 3 and allergic to peanuts; she carries an EpiPen.",
    pii: ["Siobhan", "O'Connor"],
    keep: ["peanuts", "EpiPen"],
  },
  {
    text: "Our house is at 1180 Ridgecrest Drive, and the gas shutoff is on the north side. Email: the.garcias@example.net",
    pii: ["1180 Ridgecrest Drive", "the.garcias@example.net"],
    keep: ["gas shutoff"],
  },
  {
    text: "I'm a single dad with twins, Mateo and Lucia, both 6. We're on the second floor of a duplex in Tulsa, OK.",
    pii: ["Mateo", "Lucia", "Tulsa"],
    keep: ["second floor", "duplex"],
  },
  {
    text: "My roommate Jordan works nights at the hospital. Our landlord's cell is +1 512 555 0177.",
    pii: ["Jordan", "+1 512 555 0177"],
    keep: ["hospital"],
  },
  {
    text: "Grandpa Ernesto lives with us and is on dialysis three times a week at the clinic on 5th Street.",
    pii: ["Ernesto"],
    keep: ["dialysis"],
  },
  {
    text: "Our golden retriever, Hank, and the horse, Duchess, are both in the barn.",
    pii: ["Hank", "Duchess"],
    keep: ["golden retriever", "barn"],
  },
  {
    text: "We moved to Flagstaff last year. My wife Keisha is pregnant (due in March) and my stepson Tyrell has asthma.",
    pii: ["Flagstaff", "Keisha", "Tyrell"],
    keep: ["pregnant", "asthma"],
  },
  {
    text: "Me and my boyfriend Luca live in a studio. His mom, Francesca, calls from Italy every day at +39 06 5555 1234.",
    pii: ["Luca", "Francesca", "+39 06 5555 1234"],
  },
  {
    text: "Our cabin is at 44.0582, -121.3153. Nearest neighbor is two miles away.",
    pii: ["44.0582, -121.3153"],
    keep: ["two miles"],
  },
  {
    text: "Mailing address is PO Box 812, but we're actually on the ranch off Highway 287.",
    pii: ["PO Box 812"],
    keep: ["ranch"],
  },
  {
    text: "My brother Dmitri and his wife Anya are staying with us with their baby, Sasha (age 1).",
    pii: ["Dmitri", "Anya", "Sasha"],
    keep: ["baby"],
  },
  {
    text: "I have MS and use a power wheelchair. My caregiver Rosa comes weekdays from 9 to 5.",
    pii: ["Rosa"],
    keep: ["MS", "power wheelchair"],
  },
  {
    text: "There's four of us: my wife Fatima, my son Ibrahim (12), my daughter Zainab (9) and me. We live in Dearborn, MI 48126.",
    pii: ["Fatima", "Ibrahim", "Zainab", "Dearborn", "48126"],
  },
  {
    text: "Our kids are Ava and Liam. Ava is 4 and Liam is 2 months old and formula-fed.",
    pii: ["Ava", "Liam"],
    keep: ["formula-fed"],
  },
  {
    text: "Our Labrador named Koda needs daily seizure meds, and the vet is at www.example-vet.com/clinic.",
    pii: ["Koda", "www.example-vet.com/clinic"],
    keep: ["seizure meds"],
  },
  {
    text: "My elderly mom Hyun-joo lives in the basement apartment and doesn't speak English well.",
    pii: ["Hyun-joo"],
    keep: ["basement apartment"],
  },
  {
    text: "I'm in a high-rise at 300 E Randolph St, Unit 2104, Chicago IL 60601.",
    pii: ["300 E Randolph St", "2104", "Chicago", "60601"],
    keep: ["high-rise"],
  },
  {
    text: "Our neighbors, the Kowalskis, have a well. We are on city water.",
    pii: ["Kowalskis"],
    keep: ["well", "city water"],
  },
  {
    text: "My niece Imani is visiting for the week. She has sickle cell disease.",
    pii: ["Imani"],
    keep: ["sickle cell disease"],
  },
  {
    text: "We have a parrot called Rio and a pit bull, Tank, who doesn't get along with other dogs.",
    pii: ["Rio", "Tank"],
  },
  {
    text: "My grandfather Bartholomew is 91, a veteran, and on hospice care at home.",
    pii: ["Bartholomew"],
    keep: ["hospice care"],
  },
  {
    text: "Me (Rahul Mehta), my wife Deepa, and our son Arjun. We live in Edison, NJ. Rahul's phone: 732.555.0123.",
    pii: ["Rahul", "Mehta", "Deepa", "Arjun", "Edison", "732.555.0123"],
  },
  {
    text: "Our address is 17 Old Mill Lane, Bath BA1 2AB, and my partner Gwen is a paramedic.",
    pii: ["17 Old Mill Lane", "Bath", "BA1 2AB", "Gwen"],
    keep: ["paramedic"],
  },
  {
    text: "We live near Calgary in a bungalow, postal code T2P 1J9. My husband Connor has type 2 diabetes.",
    pii: ["Calgary", "T2P 1J9", "Connor"],
    keep: ["bungalow", "type 2 diabetes"],
  },
  {
    text: "Our son Ezekiel is autistic and nonverbal and gets distressed by loud alarms.",
    pii: ["Ezekiel"],
    keep: ["autistic", "nonverbal"],
  },
  {
    text: "I'm a teacher. My wife Ngozi and I just had a baby, Chidi. We have a gas stove and a 2 week pantry.",
    pii: ["Ngozi", "Chidi"],
    keep: ["gas stove", "2 week pantry"],
  },
  {
    text: "Bring the dog and the go-bag if we evacuate; the dog is a beagle named Rufus.",
    pii: ["Rufus"],
    keep: ["Bring the dog", "go-bag"],
  },
  {
    text: "Our family: me, Ximena, my husband Joaquín, and our daughters Valentina and Camila.",
    pii: ["Ximena", "Joaquín", "Valentina", "Camila"],
  },
  {
    text: "My SSN is 123-45-6789 and my card is 4111 1111 1111 1111, just in case that matters for the scenario.",
    pii: ["123-45-6789", "4111 1111 1111 1111"],
  },
  {
    text: "We rent a mobile home in Lakeland, Florida. My girlfriend Destiny is 7 months pregnant.",
    pii: ["Lakeland", "Destiny"],
    keep: ["mobile home", "Florida", "7 months pregnant"],
  },
  {
    text: "My son Thabo uses a feeding pump that runs on a battery that lasts 18 hours.",
    pii: ["Thabo"],
    keep: ["feeding pump", "18 hours"],
  },
  {
    text: "Our place is 908 Sycamore Ct in Boise, ID 83702. The kids are Harper, Wyatt and Juniper.",
    pii: ["908 Sycamore Ct", "Boise", "83702", "Harper", "Wyatt", "Juniper"],
  },
  {
    text: "My father Giuseppe Romano has a pacemaker; his cardiologist's email is cardio.office@example.org.",
    pii: ["Giuseppe", "Romano", "cardio.office@example.org"],
    keep: ["pacemaker"],
  },
  {
    text: "We have chickens named Henrietta, Nugget and Clucky, plus a rabbit, Thumper.",
    pii: ["Henrietta", "Nugget", "Clucky", "Thumper"],
  },
  {
    text: "Me and my sister Tamar share a townhouse; she's deaf and relies on her phone for alerts.",
    pii: ["Tamar"],
    keep: ["deaf", "townhouse"],
  },
  {
    text: "Call 555-0188 for the building manager. My friend Oluwaseun is staying in the guest room.",
    pii: ["555-0188", "Oluwaseun"],
  },
  {
    text: "I'm a nurse living in Anchorage, AK with my husband Nanook and our husky, Aurora.",
    pii: ["Anchorage", "Nanook", "Aurora"],
    keep: ["nurse", "AK"],
  },
  {
    text: "Household is my partner Alex Rivera, our toddler Noor, and me. Alex works at the water treatment plant.",
    pii: ["Alex", "Rivera", "Noor"],
    keep: ["water treatment plant"],
  },
  {
    text: "We have 3 days of food, 15 gallons of water, a 2000 W inverter generator and 5 gallons of gas.",
    pii: [],
    keep: ["3 days", "15 gallons", "2000 W", "5 gallons"],
  },
  {
    text: "My grandson Kofi stays with us on weekends. Our house in Savannah, GA is a 1920s bungalow near the river.",
    pii: ["Kofi", "Savannah"],
    keep: ["GA", "1920s bungalow", "river"],
  },
  {
    text: "Our address: 2600 N Lincoln Blvd, Oklahoma City, OK 73105. Spouse: my wife Wren. Contact wren.okc@example.com.",
    pii: ["2600 N Lincoln Blvd", "Oklahoma City", "73105", "Wren", "wren.okc@example.com"],
  },
  {
    text: "Our foster kids are Jaylen and Marisol; their caseworker's number is 404-555-0110.",
    pii: ["Jaylen", "Marisol", "404-555-0110"],
  },
  // Mid-exercise actions, which mostly mention brands and places that must survive.
  {
    text: "Hi, I'm Bronwyn. I live with my partner Teodoro and our 3 kids: Elif, Ruairi and Marguerite. We're at 77 Quarry Hill Road, Montpelier VT 05602.",
    pii: ["Bronwyn", "Teodoro", "Elif", "Ruairi", "Marguerite", "77 Quarry Hill Road", "Montpelier", "05602"],
    keep: ["VT"],
  },
  {
    text: "Dad (Hamid) is 80 and on blood thinners. Mom passed last year. I'm his only caregiver.",
    pii: ["Hamid"],
    keep: ["Dad", "blood thinners"],
  },
  {
    text: "We've got a German shepherd mix called Oso and a barn cat we call Whiskers.",
    pii: ["Oso", "Whiskers"],
  },
  {
    text: "Kenji and I live in a third-floor walkup; his phone is 917 555 0163.",
    pii: ["Kenji", "917 555 0163"],
  },
  {
    text: "Fill the bathtub, move everyone into the living room, and run the Generac for 2 hours.",
    pii: [],
    keep: ["Generac", "2 hours"],
  },
  {
    text: "I drive to the Walmart on Route 9 and buy ice, then check on Mrs. Abernathy across the street.",
    pii: ["Abernathy"],
    keep: ["Walmart", "Route 9"],
  },
  {
    text: "Use the Coleman stove outside, keep the Honda EU2200i away from windows, and ration 5 gallons of water.",
    pii: [],
    keep: ["Coleman", "Honda EU2200i", "5 gallons"],
  },
  {
    text: "Our neighbor Mr. Delacroix has a chainsaw. I ask him to help clear the driveway.",
    pii: ["Delacroix"],
    keep: ["chainsaw"],
  },
  {
    text: "My stepdaughter Paloma and her boyfriend Reza are staying over; Reza is a volunteer firefighter.",
    pii: ["Paloma", "Reza"],
    keep: ["volunteer firefighter"],
  },
  {
    text: "We live on a sailboat in Marina del Rey. My husband is Torvald and our cat is named Pickles.",
    pii: ["Marina del Rey", "del Rey", "Torvald", "Pickles"],
    keep: ["sailboat"],
  },
  {
    text: "Granny Ilse is 88, hard of hearing, and lives in the in-law suite out back.",
    pii: ["Ilse"],
    keep: ["hard of hearing", "in-law suite"],
  },
  {
    text: "My two teenagers, Saoirse and Declan, are home alone after school until 6.",
    pii: ["Saoirse", "Declan"],
  },
  {
    text: "We evacuate to my cousin's place in Sacramento via I-80 and stop at the Costco for fuel.",
    pii: ["Sacramento"],
    keep: ["I-80", "Costco"],
  },
  {
    text: "I'm Wiremu, my wife is Aroha, and our boy Tama has epilepsy. We're in Rotorua.",
    pii: ["Wiremu", "Aroha", "Tama", "Rotorua"],
    keep: ["epilepsy"],
  },
  {
    text: "Text me at 646-555-0134 if the power comes back; email backup is fam.okafor@example.com.",
    pii: ["646-555-0134", "fam.okafor@example.com", "okafor"],
  },
  {
    text: "The Abernathy-Smiths across the road have chickens and a woodstove.",
    pii: ["Abernathy-Smiths"],
    keep: ["chickens", "woodstove"],
  },
  {
    text: "My aunt, who goes by Bunny, needs help getting down the stairs.",
    pii: ["Bunny"],
  },
  {
    text: "Check the Jackery, charge the Midland radio, and put the Mountain House meals in the go-bag.",
    pii: [],
    keep: ["Jackery", "Midland", "Mountain House"],
  },
];
