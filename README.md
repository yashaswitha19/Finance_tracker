# 💰 Personal Finance Tracker with AI Assistant

A comprehensive full-stack web application designed to help users track income, manage expenses, and gain financial insights through an integrated AI chatbot.

## 🌟 Key Features

- **Smart Dashboard:** View your Total Income, Total Expenses, and All-Time Balance at a glance.
- **AI Financial Assistant:** Powered by **Gemini 2.5 Flash**. Ask questions like *"How much did I spend on food?"* or *"Am I over my budget?"*
- **Transaction Management:** Full CRUD (Create, Read, Update, Delete) functionality for all your financial records.
- **Budget Tracking:** Set monthly limits and get visual warnings when you approach or exceed them.
- **Detailed Reports:** Filter data by date range and view category-wise breakdowns.
- **Data Export:** Export your financial reports to **PDF** or **CSV** formats.
- **User Authentication:** Secure session-based login and signup system with profile picture support.

---

## 🛠️ Technical Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **AI Engine:** Google GenAI SDK (`@google/genai`)
- **Templating:** EJS (Embedded JavaScript)
- **Styling:** Bootstrap 5 & Custom CSS
- **File Handling:** Multer (for profile pictures)

---

## 📋 Database Schema (SQL)

To set up your database, run the following queries in your PostgreSQL tool (like pgAdmin or psql):

```sql
-- Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    profile_pic TEXT DEFAULT '/uploads/default-avatar.png'
);

-- Transactions Table
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type VARCHAR(10) CHECK (type IN ('income', 'expense')),
    category VARCHAR(50),
    amount DECIMAL(10, 2),
    date DATE DEFAULT CURRENT_DATE,
    note TEXT
);

-- Budget Table
CREATE TABLE budget (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    month_year DATE,
    budget_amount DECIMAL(10, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

⚙️ Installation & Setup

1. Clone the Project
git clone [https://github.com/Rohithasiri/Finanace.git](https://github.com/Rohithasiri/Finanace.git)
cd Finanace

2. Install Dependencies
npm install

3. Environment Configuration
Create a file named .env in the root folder and paste the following, replacing the placeholders with your actual credentials:

PORT=3000
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=financedb
DB_HOST=localhost
DB_PORT=5432
GEMINI_API_KEY=your_gemini_api_key_from_ai_studio
SESSION_SECRET=a_random_secure_string

4. Run the Application
node index.js
The app will be live at http://localhost:3000.

🤖 AI Assistant Usage
The chatbot uses Gemini 2.5 Flash to analyze your live database. To get specific answers:

Ensure you have categorized your transactions (e.g., "Food", "Rent", "Salary").

Open the Chatbot on the Dashboard.

Ask: "How much did I spend on Food this month?"

🛡️ License
This project is open-source under the MIT License.

---

### How to push this to your GitHub:
1.  **Save** the content above into a file named `README.md` in your project folder.
2.  Run these commands in your terminal:
    ```bash
    git add README.md
    git commit -m "Added complete copy-paste README with SQL schema"
    git push origin main
    ```
