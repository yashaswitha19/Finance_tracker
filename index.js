import express from "express";
import pg from "pg";
import session from 'express-session';
import { Parser } from 'json2csv';
import PDFDocument from 'pdfkit';
import multer from "multer";
import path from "path";
import fs from "fs";
const app = express();
const port = 3000;
const PORT = process.env.PORT || 3000;
app.set('view engine', 'ejs');

// app.use(session({
//   secret: 'yashu',   // change this
//   resave: false,
//   saveUninitialized: false
// }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev_secret",
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  res.locals.user = req.session ? req.session.user : null;
  next();
});

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

// const db = new pg.Client({
//   user: "postgres",
//   host: "localhost",
//   database: "financedb",
//   password: "Yashu@19",
//   port: 5432,
// });
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }   // required on Render
});
db.connect();

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next(); // user is logged in
  } else {
    res.redirect('/login'); // redirect to login page
  }
} 

// helpers/getDashboardData.js or in the same file
async function getDashboardData(userId) {
  try {
    // Get total income for the user
    const query1 =
      "SELECT SUM(amount) AS total_income FROM transactions WHERE type = $1 AND user_id = $2";
    const result1 = await db.query(query1, ["income", userId]);
    const totalIncome = result1.rows[0].total_income || 0;

    // Get total expense for the user
    const query2 =
      "SELECT SUM(amount) AS total_expense FROM transactions WHERE type = $1 AND user_id = $2";
    const result2 = await db.query(query2, ["expense", userId]);
    const totalExpense = result2.rows[0].total_expense || 0;

    // Get budget for the current month and user
    const query3 = `
      SELECT * FROM budget 
      WHERE month_year = DATE_TRUNC('month', CURRENT_DATE)::DATE AND user_id = $1
    `;
    const result3 = await db.query(query3, [userId]);
    const bud = result3.rows.length > 0 ? result3.rows[0].budget_amount : 0;

    // Get recent transactions for the user
    const query4 = `
      SELECT 
        id,
        TO_CHAR(date, 'DD/MM/YYYY') AS formatted_date,
        date,
        type,
        category,
        amount,
        note
      FROM transactions
      WHERE user_id = $1
      ORDER BY date ASC, id ASC
      LIMIT 5
    `;
    const result4 = await db.query(query4, [userId]);
    const transactions = result4.rows;

    console.log("Total Income:", totalIncome);
    console.log("Total Expense:", totalExpense);
    console.log("Budget:", bud);

    return {
      totalincome: totalIncome,
      totalexpense: totalExpense,
      transactions: transactions,
      budget: bud,
    };
  } catch (err) {
    throw err;
  }
}

async function generateReportData(startDate, endDate, userId) {
  try {
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense
      FROM transactions
      WHERE date >= $1::DATE AND date <= $2::DATE
        AND user_id = $3
    `;
    const summaryResult = await db.query(summaryQuery, [startDate, endDate, userId]);
    const totalIncome = parseFloat(summaryResult.rows[0].total_income) || 0;
    const totalExpense = parseFloat(summaryResult.rows[0].total_expense) || 0;
    const netBalance = totalIncome - totalExpense;
    const savingsRate =
      totalIncome > 0 ? ((netBalance / totalIncome) * 100).toFixed(2) : 0;

    const incomeReportQuery = `
      SELECT 
        category,
        COUNT(*) AS transaction_count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM transactions
      WHERE type = 'income' 
        AND date >= $1::DATE 
        AND date <= $2::DATE
        AND user_id = $3
      GROUP BY category
      ORDER BY total_amount DESC
    `;
    const incomeReportResult = await db.query(incomeReportQuery, [startDate, endDate, userId]);
    const incomeReport = incomeReportResult.rows.map((row) => ({
      category: row.category,
      count: parseInt(row.transaction_count),
      amount: parseFloat(row.total_amount),
      percentage:
        totalIncome > 0
          ? ((parseFloat(row.total_amount) / totalIncome) * 100).toFixed(2)
          : 0,
    }));

    const expenseReportQuery = `
      SELECT 
        category,
        COUNT(*) AS transaction_count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM transactions
      WHERE type = 'expense' 
        AND date >= $1::DATE 
        AND date <= $2::DATE
        AND user_id = $3
      GROUP BY category
      ORDER BY total_amount DESC
    `;
    const expenseReportResult = await db.query(expenseReportQuery, [startDate, endDate, userId]);
    const expenseReport = expenseReportResult.rows.map((row) => ({
      category: row.category,
      count: parseInt(row.transaction_count),
      amount: parseFloat(row.total_amount),
      percentage:
        totalExpense > 0
          ? ((parseFloat(row.total_amount) / totalExpense) * 100).toFixed(2)
          : 0,
    }));

    const monthlyQuery = `
      SELECT 
        TO_CHAR(date, 'Mon YYYY') AS month,
        DATE_TRUNC('month', date) AS month_date,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions
      WHERE date >= $1::DATE AND date <= $2::DATE
        AND user_id = $3
      GROUP BY DATE_TRUNC('month', date), TO_CHAR(date, 'Mon YYYY')
      ORDER BY DATE_TRUNC('month', date) ASC
    `;
    const monthlyResult = await db.query(monthlyQuery, [startDate, endDate, userId]);
    const monthlyBreakdown = monthlyResult.rows.map((row) => ({
      month: row.month,
      income: parseFloat(row.income),
      expense: parseFloat(row.expense),
      balance: parseFloat(row.income) - parseFloat(row.expense),
    }));

    const top5ExpensesQuery = `
      SELECT 
        category,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM transactions
      WHERE type = 'expense' 
        AND date >= $1::DATE 
        AND date <= $2::DATE
        AND user_id = $3
      GROUP BY category
      ORDER BY total_amount DESC
      LIMIT 5
    `;
    const top5Result = await db.query(top5ExpensesQuery, [startDate, endDate, userId]);
    const topCategories = {
      labels: top5Result.rows.map((row) => row.category),
      data: top5Result.rows.map((row) => parseFloat(row.total_amount)),
    };

    const balanceTrend = {
      labels: monthlyBreakdown.map((m) => m.month),
      data: monthlyBreakdown.map((m) => m.balance),
    };

    return {
      totalIncome,
      totalExpense,
      netBalance,
      savingsRate,
      incomeReport,
      expenseReport,
      monthlyBreakdown,
      topCategories,
      balanceTrend,
    };
  } catch (err) {
    console.error("Error in generateReportData:", err);
    throw err;
  }
}

async function getBudgetData(userId) {
  try {
    // Get current month
    const currentDate = new Date();
    const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const currentMonthStr = currentMonth.toISOString().slice(0, 7);

    // 1. Get current month budget for user
    const currentBudgetQuery = `
      SELECT budget_amount
      FROM budget
      WHERE month_year = $1 AND user_id = $2
    `;
    const currentBudgetResult = await db.query(currentBudgetQuery, [
      currentMonth,
      userId,
    ]);
    const budgetLimit = currentBudgetResult.rows.length > 0 ? parseFloat(currentBudgetResult.rows[0].budget_amount) : 0;

    // 2. Get current month expenses for user
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const expenseQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_expense
      FROM transactions
      WHERE type = 'expense'
        AND date >= $1
        AND date <= $2
        AND user_id = $3
    `;
    const expenseResult = await db.query(expenseQuery, [firstDay, lastDay, userId]);
    const spentAmount = parseFloat(expenseResult.rows[0].total_expense) || 0;

    // Calculate remaining and percentage
    const remaining = budgetLimit - spentAmount;
    const percentage = budgetLimit > 0 ? ((spentAmount / budgetLimit) * 100).toFixed(2) : 0;

    // Determine status
    let status = "success";
    let statusMessage = "Great! You're within your budget. Keep up the good work!";
    let statusIcon = "check-circle";

    if (percentage >= 100) {
      status = "danger";
      statusMessage = "Warning! You've exceeded your budget limit.";
      statusIcon = "exclamation-triangle";
    } else if (percentage >= 80) {
      status = "warning";
      statusMessage = "Caution! You're approaching your budget limit.";
      statusIcon = "exclamation-circle";
    }

    // 3. Get budget history (last 6 months) for user
    const historyQuery = `
      SELECT 
        b.month_year,
        TO_CHAR(b.month_year, 'Mon YYYY') AS month_name,
        b.budget_amount,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS spent
      FROM budget b
      LEFT JOIN transactions t ON DATE_TRUNC('month', t.date) = b.month_year AND t.user_id = b.user_id
      WHERE b.user_id = $1
      GROUP BY b.month_year, b.budget_amount
      ORDER BY b.month_year DESC
      LIMIT 6
    `;
    const historyResult = await db.query(historyQuery, [userId]);

    const budgetHistory = historyResult.rows.map((row) => {
      const budget = parseFloat(row.budget_amount);
      const spent = parseFloat(row.spent);
      const remaining = budget - spent;
      const isOverBudget = spent > budget;

      const monthDate = new Date(row.month_year);
      const monthName = monthDate.toLocaleString("default", { month: "long" });
      const year = monthDate.getFullYear();

      return {
        month: `${monthName} ${year}`,
        budget,
        spent,
        remaining,
        status: isOverBudget ? "Over Budget" : "Within Budget",
        statusClass: isOverBudget ? "danger" : "success",
      };
    });

    // 4. Prepare data for charts (last 6 months)
    const chartData = {
      labels: budgetHistory.map((h) => h.month).reverse(),
      budgetData: budgetHistory.map((h) => h.budget).reverse(),
      spentData: budgetHistory.map((h) => h.spent).reverse(),
      remainingData: budgetHistory.map((h) => h.remaining).reverse(),
    };

    // Return all data
    return {
      currentMonth: currentMonthStr,
      budgetLimit,
      spentAmount,
      remaining,
      percentage,
      status,
      statusMessage,
      statusIcon,
      budgetHistory,
      chartData,
    };
  } catch (err) {
    console.error("Error in getBudgetData:", err);
    throw err;
  }
}

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});
app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.get("/transactions", isAuthenticated,(req, res) => {
  res.render("transactions.ejs", { 
    isInserted: false 
  });
});

app.get('/home', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;  // Get logged-in user's ID

    // Step 1: Get current month start date
    const now = new Date();
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentMonthStart = new Date(currentYear, currentMonth - 1, 1);

    // Step 2: Queries including user_id condition

    const currentStatsQuery = {
      text: `
        SELECT type, SUM(amount) AS total
        FROM transactions
        WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
          AND user_id = $1
        GROUP BY type
      `,
      values: [userId]
    };

    const allTimeStatsQuery = {
      text: `
        SELECT type, SUM(amount) AS total
        FROM transactions
        WHERE user_id = $1 
          AND date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
        GROUP BY type
      `,
      values: [userId]
    };

    const budgetQuery = {
      text: `
        SELECT budget_amount
        FROM budget
        WHERE month_year >= $1 AND month_year < $2 AND user_id = $3
      `,
      values: [currentMonthStart.toISOString().split('T')[0],nextMonthStart.toISOString().split('T')[0], userId]
    };

    const transactionsQuery = {
      text: `
        SELECT *
        FROM transactions
        WHERE user_id = $1
        ORDER BY date DESC
        LIMIT 5
      `,
      values: [userId]
    };

    const pieChartQuery = {
      text: `
        SELECT category, SUM(amount) AS total
        FROM transactions
        WHERE type = 'expense'
          AND date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
          AND user_id = $1
        GROUP BY category
        ORDER BY total DESC
        LIMIT 5
      `,
      values: [userId]
    };

    const monthlyTrendQuery = {
      text: `
        WITH months AS (
          SELECT DISTINCT to_char(date_trunc('month', (current_date - (n || ' month')::interval)), 'YYYY-MM') AS month_name
          FROM generate_series(0, 5) n
        ),
        income AS (
          SELECT to_char(date, 'YYYY-MM') AS month_name, SUM(amount) AS total
          FROM transactions
          WHERE type = 'income' AND date >= (current_date - '5 months'::interval) AND user_id = $1
          GROUP BY month_name
        ),
        expense AS (
          SELECT to_char(date, 'YYYY-MM') AS month_name, SUM(amount) AS total
          FROM transactions
          WHERE type = 'expense' AND date >= (current_date - '5 months'::interval) AND user_id = $1
          GROUP BY month_name
        )
        SELECT 
          m.month_name, 
          COALESCE(i.total, 0) AS income,
          COALESCE(e.total, 0) AS expense
        FROM months m
        LEFT JOIN income i ON m.month_name = i.month_name
        LEFT JOIN expense e ON m.month_name = e.month_name
        ORDER BY m.month_name ASC
      `,
      values: [userId]
    };

    // Step 3: Run all queries in parallel
    const [
      currentStatsResult,
      allTimeStatsResult,
      budgetResult,
      transactionsResult,
      pieChartResult,
      monthlyTrendResult
    ] = await Promise.all([
      db.query(currentStatsQuery),
      db.query(allTimeStatsQuery),
      db.query(budgetQuery),
      db.query(transactionsQuery),
      db.query(pieChartQuery),
      db.query(monthlyTrendQuery)
    ]);

    // Step 4: Defensive data handling
    const currentStats = (currentStatsResult.rows || []).reduce((acc, row) => {
      acc[row.type.toLowerCase()] = parseFloat(row.total);
      return acc;
    }, { income: 0, expense: 0 });

    const allTimeStats = (allTimeStatsResult.rows || []).reduce((acc, row) => {
      acc[row.type.toLowerCase()] = parseFloat(row.total);
      return acc;
    }, { income: 0, expense: 0 });

    const totalincome = currentStats.income || 0;
    const totalexpense = currentStats.expense || 0;
    const allTimeBalance = allTimeStats.income - allTimeStats.expense;
    const budget = budgetResult.rows[0]?.budget_amount || 0;
    const budgetRemaining = budget - totalexpense;

    const transactions = transactionsResult.rows || [];
    const pieChartData = {
      labels: pieChartResult.rows.map(r => r.category),
      data: pieChartResult.rows.map(r => parseFloat(r.total))
    };
    const barChartData = {
      labels: monthlyTrendResult.rows.map(r => {
        const [year, month] = r.month_name.split('-');
        return new Date(year, month - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
      }),
      income: monthlyTrendResult.rows.map(r => parseFloat(r.income)),
      expense: monthlyTrendResult.rows.map(r => parseFloat(r.expense)),
      balance: monthlyTrendResult.rows.map(r => r.income - r.expense)
    };

    console.log("✅ Totals prepared:", { totalincome, totalexpense, allTimeBalance });

    // Step 5: Render safely
    res.render("home", {
      totalincome,
      totalexpense,
      allTimeBalance,
      budget,
      budgetRemaining,
      transactions,
      pieChartData,
      barChartData,
      currentPage: 'dashboard',
      user: req.session.user
    });
  } catch (err) {
    console.error("❌ Error fetching dashboard data:", err.stack || err);
    res.status(500).send("Server Error");
  }
});

app.get("/managetr", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;  // Get user ID from session
    const dashboardData = await getDashboardData(userId);
    res.render("managetr.ejs", {
      ...dashboardData,
      user: req.session.user
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Server Error");
  }
});

app.get("/report", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id; // Get user ID from session

    const currentDate = new Date();
    const firstDay = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const lastDay = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0
    );

    const startDate = firstDay.toISOString().split("T")[0];
    const endDate = lastDay.toISOString().split("T")[0];

    // Pass userId to generateReportData
    const reportData = await generateReportData(startDate, endDate, userId);

    const topCategories = {
      labels: reportData.expenseReport.slice(0, 5).map(item => item.category),
      data: reportData.expenseReport.slice(0, 5).map(item => item.amount)
    };

    const balanceTrend = {
      labels: reportData.monthlyBreakdown.map(item => item.month),
      income: reportData.monthlyBreakdown.map(item => item.income),
      expense: reportData.monthlyBreakdown.map(item => item.expense),
      balance: reportData.monthlyBreakdown.map(item => item.balance)
    };

    res.render("report.ejs", {
      ...reportData,
      startDate,
      endDate,
      topCategories,
      balanceTrend,
      user: req.session.user
    });
  } catch (err) {
    console.error("Error loading report:", err);
    res.status(500).send("Server Error");
  }
});

app.get("/budget", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id; // Get the logged-in user's ID

    // --- 1. Get Current Month ---
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = (now.getMonth() + 1).toString().padStart(2, '0');
    const currentMonth = `${currentYear}-${currentMonthNum}`; // e.g., "2025-10"
    const currentMonthDate = `${currentMonth}-01`; // e.g., "2025-10-01"

    // --- 2. Define All Database Queries with user_id filter ---

    // Query 1: Get the budget limit for the CURRENT month for this user
    const budgetQuery = {
      text: "SELECT budget_amount FROM budget WHERE month_year = $1 AND user_id = $2",
      values: [currentMonthDate, userId],
    };

    // Query 2: Get the total spent for the CURRENT month by this user
    const spentQuery = {
      text: `
        SELECT SUM(amount) AS total_spent 
        FROM transactions 
        WHERE type = 'expense' 
          AND to_char(date, 'YYYY-MM') = $1
          AND user_id = $2
      `,
      values: [currentMonth, userId],
    };

    // Query 3: Get the budget history with spending for EACH month for this user
    const historyQuery = {
      text: `
        SELECT 
          b.month_year, 
          b.budget_amount, 
          COALESCE(SUM(t.amount), 0) AS spent
        FROM budget b
        LEFT JOIN transactions t 
          ON to_char(b.month_year, 'YYYY-MM') = to_char(t.date, 'YYYY-MM') 
          AND t.type = 'expense'
          AND t.user_id = b.user_id
        WHERE b.user_id = $1
        GROUP BY b.month_year, b.budget_amount
        ORDER BY b.month_year DESC
      `,
      values: [userId],
    };

    // --- 3. Run All Queries in Parallel ---
    const [budgetResult, spentResult, historyResult] = await Promise.all([
      db.query(budgetQuery),
      db.query(spentQuery),
      db.query(historyQuery),
    ]);

    // --- 4. Process Current Month's Summary ---
    const budgetLimit = budgetResult.rows[0]?.budget_amount || 0;
    const spentAmount = spentResult.rows[0]?.total_spent || 0;
    const remaining = budgetLimit - spentAmount;

    // Calculate percentage, handling division by zero
    const percentage = (budgetLimit > 0) ? Math.round((spentAmount / budgetLimit) * 100) : 0;

    let status, statusIcon, statusMessage;
    if (percentage > 100) {
      status = "danger";
      statusIcon = "exclamation-triangle-fill";
      statusMessage = "You've gone over your budget!";
    } else if (percentage >= 80) {
      status = "warning";
      statusIcon = "exclamation-triangle-fill";
      statusMessage = "You're close to your budget limit.";
    } else {
      status = "success";
      statusIcon = "check-circle-fill";
      statusMessage = "You're well within your budget.";
    }

    // Special case: If no budget is set, override status
    if (budgetLimit === 0) {
      status = "info";
      statusIcon = "info-circle-fill";
      statusMessage = "Set a budget to start tracking.";
    }

    // --- 5. Process Budget History (for table) ---
    const budgetHistory = historyResult.rows.map(row => {
      const rowRemaining = row.budget_amount - row.spent;
      const rowStatus = rowRemaining >= 0 ? 'Under Budget' : 'Over Budget';
      const rowStatusClass = rowRemaining >= 0 ? 'success' : 'danger';

      const monthDate = new Date(row.month_year);
      const monthName = monthDate.toLocaleString('default', { month: 'long' });
      const year = monthDate.getFullYear();

      return {
        month: `${monthName} ${year}`,
        budget: row.budget_amount,
        spent: row.spent,
        remaining: rowRemaining,
        status: rowStatus,
        statusClass: rowStatusClass
      };
    });

    // --- 6. Prepare Chart Data ---
    const historyForCharts = [...budgetHistory].reverse();  // Oldest to newest
    const chartData = {
      labels: historyForCharts.map(item => item.month),
      spent: historyForCharts.map(item => item.spent),
      remaining: historyForCharts.map(item => item.remaining)
    };

    // --- 7. Render the Page ---
    res.render("budget.ejs", {
      currentMonth,
      budgetLimit,
      spentAmount,
      remaining,
      percentage,
      status,
      statusIcon,
      statusMessage,
      budgetHistory,
      chartData,
      user: req.session.user  // Pass user info for view access
    });

  } catch (err) {
    console.error("Error fetching budget page data:", err);
    res.status(500).send("Server Error");
  }
});

app.post("/managetr", async (req, res) => {
  try {
    const { type, category, startDate, endDate, note } = req.body;
    const userId = req.session.user.id;  // Get user ID from session

    let whereConditions = ["user_id = $1"];  // Always filter by user_id first
    const params = [userId];
    let paramIndex = 2;  // paramIndex starts at 2 because $1 is userId

    if (type && type.trim() !== "") {
      whereConditions.push(`type = $${paramIndex}`);
      params.push(type.trim());
      paramIndex++;
    }

    if (category && category.trim() !== "") {
      whereConditions.push(`category = $${paramIndex}`);
      params.push(category.trim());
      paramIndex++;
    }

    if (startDate && startDate.trim() !== "") {
      whereConditions.push(`date >= $${paramIndex}::DATE`);
      params.push(startDate.trim());
      paramIndex++;
    }

    if (endDate && endDate.trim() !== "") {
      whereConditions.push(`date <= $${paramIndex}::DATE`);
      params.push(endDate.trim());
      paramIndex++;
    }

    if (note && typeof note === "string" && note.trim() !== "") {
      whereConditions.push(`note ILIKE $${paramIndex}`);
      params.push(`%${note.trim()}%`);
      paramIndex++;
      console.log(`✅ Note filter applied: "%${note.trim()}%"`);
    } else {
      console.log(`❌ Note filter skipped. Value:`, JSON.stringify(note));
    }

    const whereClause = whereConditions.length > 0 ? "WHERE " + whereConditions.join(" AND ") : "";

    // Income specific filters
    let incomeWhereConditions = [...whereConditions];
    let incomeParams = [...params];

    if (!type || type.trim() === "") {
      incomeWhereConditions.push(`type = 'income'`);
    }
    const incomeWhereClause =
      incomeWhereConditions.length > 0 ? "WHERE " + incomeWhereConditions.join(" AND ") : "";

    // Expense specific filters
    let expenseWhereConditions = [...whereConditions];
    let expenseParams = [...params];

    if (!type || type.trim() === "") {
      expenseWhereConditions.push(`type = 'expense'`);
    }
    const expenseWhereClause =
      expenseWhereConditions.length > 0 ? "WHERE " + expenseWhereConditions.join(" AND ") : "";

    // Queries including user_id filtering
    const incomeQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_income 
      FROM transactions 
      ${incomeWhereClause}
      AND type = 'income'
    `;
    const incomeResult = await db.query(incomeQuery, incomeParams);
    const totalIncome = parseFloat(incomeResult.rows[0].total_income) || 0;

    const expenseQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_expense 
      FROM transactions 
      ${expenseWhereClause}
      AND type = 'expense'
    `;
    const expenseResult = await db.query(expenseQuery, expenseParams);
    const totalExpense = parseFloat(expenseResult.rows[0].total_expense) || 0;

    const transactionsQuery = `
      SELECT 
        id,
        TO_CHAR(date, 'DD/MM/YYYY') AS formatted_date,
        date,
        type,
        category,
        amount,
        note
      FROM transactions
      ${whereClause}
      ORDER BY date DESC, id DESC
    `;

    console.log("📋 Final Query:", transactionsQuery);
    console.log("📦 Parameters:", params);

    const transactionsResult = await db.query(transactionsQuery, params);

    const budgetQuery = `
      SELECT COALESCE(budget_amount, 0) AS budget_amount
      FROM budget 
      WHERE month_year = DATE_TRUNC('month', CURRENT_DATE)::DATE
        AND user_id = $1
    `;
    const budgetResult = await db.query(budgetQuery, [userId]);
    const bud = parseFloat(budgetResult.rows[0]?.budget_amount) || 0;

    console.log("Filtered Total Income:", totalIncome);
    console.log("Filtered Total Expense:", totalExpense);
    console.log("Transactions Count:", transactionsResult.rows.length);

    res.render("managetr.ejs", {
      totalincome: totalIncome,
      totalexpense: totalExpense,
      transactions: transactionsResult.rows,
      budget: bud,
      user: req.session.user  // Pass user for template access
    });
  } catch (err) {
    console.error("Error filtering transactions:", err);
    res.status(500).send("Server Error");
  }
});

app.post("/report", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const userId = req.session.user.id; // Get logged-in user's ID

    console.log('\n=== REPORT GENERATION ===');
    console.log('[SERVER] Start Date:', startDate);
    console.log('[SERVER] End Date:', endDate);

    if (!startDate || !endDate) {
      return res.status(400).send("Start date and end date are required");
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).send("Start date cannot be after end date");
    }

    const reportData = await generateReportData(startDate.trim(), endDate.trim(), userId);
    console.log('[SERVER] Report data generated');

    const topCategories = {
      labels: reportData.expenseReport.slice(0, 5).map(item => item.category),
      data: reportData.expenseReport.slice(0, 5).map(item => item.amount)
    };

    console.log('[SERVER] Top Categories:', topCategories);
    console.log('[SERVER] - Has labels:', topCategories.labels.length > 0);
    console.log('[SERVER] - Has data:', topCategories.data.length > 0);

    const balanceTrend = {
      labels: reportData.monthlyBreakdown.map(item => item.month),
      income: reportData.monthlyBreakdown.map(item => item.income),
      expense: reportData.monthlyBreakdown.map(item => item.expense),
      balance: reportData.monthlyBreakdown.map(item => item.balance)
    };

    console.log('[SERVER] Balance Trend:', balanceTrend);
    console.log('[SERVER] - Has labels:', balanceTrend.labels.length > 0);
    console.log('[SERVER] - Data points:', balanceTrend.labels.length);

    console.log('[SERVER] Rendering report.ejs...\n');

    res.render("report.ejs", {
      ...reportData,
      startDate,
      endDate,
      topCategories,
      balanceTrend,
      user: req.session.user  // Pass user for template access
    });
  } catch (err) {
    console.error("[SERVER ERROR] Error generating report:", err);
    console.error("[SERVER ERROR] Stack trace:", err.stack);
    res.status(500).send("Server Error");
  }
});

app.post("/signup", (req, res) => {
  const namee = req.body["namee"];
  const email = req.body["email"];
  const password = req.body["password"];
  const confirmpassword = req.body["confirmPassword"];
  console.log(password, confirmpassword);

  if (password === confirmpassword) {
    db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id",
      [namee, email, password],
      (err, result) => {
        if (err) {
          console.error("Error inserting user:", err);
          return res.render("signup.ejs"); // Show signup again on error
        }
        console.log("✅ User added successfully with ID:", result.rows[0].id);

        // Save user info in session after signup
        // Redirect to home or dashboard instead of login, 
        // since user is now effectively logged in
        res.redirect("/home");
      }
    );
  } else {
    res.render("signup.ejs"); // passwords didn't match
  }
});

app.post("/login", async (req, res) => {
  const email = req.body["email"];
  const passwordentered = req.body["password"];
  req.session.user = { email };
  try {
    const result = await db.query(
      "SELECT id, name, password,profile_pic FROM users WHERE email = $1",
      [email]
    );

    if (result.rowCount === 0) {
      // no such email
      res.render("login.ejs");
    }
    const user = result.rows[0];

    if (user.password != passwordentered) {
      res.render("login.ejs");
    }
     req.session.user = {
      id : user.id,
      email: email,
      name: user.name,
      profile_pic: user.profile_pic 
    };
    res.redirect('/home');
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/transactions", (req, res) => {
  const note = req.body["note"];
  const date = req.body["date"];
  const amount = req.body["amount"];
  const category = req.body["category"];
  const type = req.body["type"];
  const user_id = req.session.user.id; // Assuming req.user contains the authenticated user info

  const query = `
    INSERT INTO transactions (type, amount, category, date, note, user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  const values = [type, amount, category, date, note, user_id];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error inserting transaction:", err);
      res.render("transactions.ejs", { isInserted: false });
    } else {
      console.log("Transaction added successfully!");
      res.render("transactions.ejs", { isInserted: true });
    }
  });
});

app.post("/budget", async (req, res) => {
  try {
    const { amount, month } = req.body;
    const userId = req.session.user?.id; // Safe access using optional chaining
    
    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    if (!amount || !month) {
      return res.status(400).send("Amount and month are required");
    }

    const budgetAmount = parseFloat(amount.trim());
    const monthTrimmed = month.trim();

    if (budgetAmount <= 0) {
      return res.status(400).send("Budget amount must be greater than 0");
    }

    const monthDateStr = monthTrimmed + "-01";

    const existingBudget = await db.query(
      "SELECT * FROM budget WHERE month_year = $1 AND user_id = $2",
      [monthDateStr, userId]
    );

    if (existingBudget.rows.length > 0) {
      await db.query(
        "UPDATE budget SET budget_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE month_year = $2 AND user_id = $3",
        [budgetAmount, monthDateStr, userId]
      );
    } else {
      await db.query(
        "INSERT INTO budget (month_year, budget_amount, user_id) VALUES ($1, $2, $3)",
        [monthDateStr, budgetAmount, userId]
      );
    }

    res.redirect("/budget");
  } catch (err) {
    console.error("Error setting budget:", err);
    res.status(500).send("Server Error");
  }
});

app.get("/profile", isAuthenticated,(req, res) => {
  const { error, success } = req.query;
  
  // Check if user exists in session, but don't require it
  
  res.render("profile.ejs", {
    error: error,
    success: success,
    user: req.session.user 
  });
});

app.post("/profile/password", async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user && req.session.user.id;
    if (!userId) {
      return res.redirect("/login");
    }

    if (newPassword !== confirmPassword) {
      return res.redirect("/profile?error=mismatch");
    }

    const result = await db.query("SELECT password FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.redirect("/login"); // user not found
    }

    const storedPassword = result.rows[0].password;

    // For plain text passwords (current approach)
    if (currentPassword !== storedPassword) {
      return res.redirect("/profile?error=incorrect");
    }

    await db.query("UPDATE users SET password = $1 WHERE id = $2", [newPassword, userId]);

    return res.redirect("/profile?success=true");
  } catch (err) {
    console.error(err);
    return res.redirect("/profile?error=server");
  }
});

app.post("/delete", async (req, res) => {
  try {
    const id = req.body["id"];
    const userId = req.session.user?.id;

    if (!userId) {
      return res.redirect("/login");
    }

    // Delete only if the transaction belongs to the logged-in user
    const result = await db.query(
      "DELETE FROM transactions WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    // Optional: You can check result.rowCount to confirm deletion
    if (result.rowCount === 0) {
      console.warn(`Delete attempt failed: Transaction ${id} not found or unauthorized`);
      // Optionally show an error message or redirect
    }

    res.redirect("/managetr");
  } catch (err) {
    console.error("Error deleting transaction:", err);
    res.status(500).send("Server Error");
  }
});

app.post("/managetr/edit", async (req, res) => {
  const { id, type, category, amount, date, note } = req.body;
  const userId = req.session.user?.id;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const result = await db.query(
      "UPDATE transactions SET type = $1, category = $2, amount = $3, date = $4, note = $5 WHERE id = $6 AND user_id = $7",
      [type, category, amount, date, note, id, userId]
    );

    if (result.rowCount === 0) {
      // No rows updated, possibly due to invalid id or ownership mismatch
      return res.redirect("/managetr?error=update_failed");
    }

    res.redirect("/managetr?success=updated");
  } catch (error) {
    console.error("Error updating transaction:", error);
    res.redirect("/managetr?error=update_failed");
  }
});

app.get('/signout', (req, res) => {
  req.session.destroy(err => {
    if (err) throw err;
    res.redirect('/');
  });
});

app.get("/export/csv", isAuthenticated, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;  // Dates from query string
    const userId = req.session.user.id;

    if (!startDate || !endDate) {
      return res.status(400).send("Start and end dates required for export");
    }

    // Generate the same report data as your /report route
    const reportData = await generateReportData(startDate, endDate, userId);

    // Combine all data into one CSV-friendly array
    const allData = [];

    reportData.incomeReport.forEach(item => {
      allData.push({
        Type: "Income",
        Category: item.category,
        Transactions: item.count,
        Amount: item.amount,
        Percentage: item.percentage,
        Month: "",
        Balance: ""
      });
    });

    reportData.expenseReport.forEach(item => {
      allData.push({
        Type: "Expense",
        Category: item.category,
        Transactions: item.count,
        Amount: item.amount,
        Percentage: item.percentage,
        Month: "",
        Balance: ""
      });
    });

    reportData.monthlyBreakdown.forEach(item => {
      allData.push({
        Type: "Monthly",
        Category: "",
        Transactions: "",
        Amount: item.income,
        Percentage: "",
        Month: item.month,
        Balance: item.balance
      });
    });

    const parser = new Parser({ fields: ["Type", "Category", "Transactions", "Amount", "Percentage", "Month", "Balance"] });
    const csv = parser.parse(allData);

    res.header("Content-Type", "text/csv");
    res.attachment("financial_report.csv");
    return res.send(csv);

  } catch (err) {
    console.error("Error exporting CSV:", err);
    res.status(500).send("Server error");
  }
});


app.get("/export/pdf", isAuthenticated, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.session.user.id;

    if (!startDate || !endDate) {
      return res.status(400).send("Start and end dates required for export");
    }

    const reportData = await generateReportData(startDate, endDate, userId);

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=financial_report.pdf");
    doc.pipe(res);

    doc.fontSize(20).text("Financial Report", { align: "center" });
    doc.moveDown();

    // Income Report
    if (reportData.incomeReport.length > 0) {
      doc.fontSize(16).fillColor('green').text("Income Report", { underline: true });
      reportData.incomeReport.forEach(item => {
        doc.fontSize(12).fillColor('black')
          .text(`${item.category} | Transactions: ${item.count} | Amount: ₹${item.amount.toLocaleString('en-IN')} | ${item.percentage}%`);
      });
      doc.moveDown();
    }

    // Expense Report
    if (reportData.expenseReport.length > 0) {
      doc.fontSize(16).fillColor('red').text("Expense Report", { underline: true });
      reportData.expenseReport.forEach(item => {
        doc.fontSize(12).fillColor('black')
          .text(`${item.category} | Transactions: ${item.count} | Amount: ₹${item.amount.toLocaleString('en-IN')} | ${item.percentage}%`);
      });
      doc.moveDown();
    }

    // Monthly Breakdown
    if (reportData.monthlyBreakdown.length > 0) {
      doc.fontSize(16).fillColor('blue').text("Monthly Breakdown", { underline: true });
      reportData.monthlyBreakdown.forEach(item => {
        doc.fontSize(12).fillColor('black')
          .text(`${item.month} | Income: ₹${item.income.toLocaleString('en-IN')} | Expense: ₹${item.expense.toLocaleString('en-IN')} | Balance: ₹${item.balance.toLocaleString('en-IN')}`);
      });
    }

    doc.end();

  } catch (err) {
    console.error("Error exporting PDF:", err);
    res.status(500).send("Server error");
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join("public", "uploads", "profiles");
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.session.user.id}_${Date.now()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB

// 2. Route to update profile picture
app.post("/update-profile-picture", upload.single("profilePic"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded");

    const userId = req.session.user.id;
    const newProfilePic = `/uploads/profiles/${req.file.filename}`;

    // Optional: delete old picture if exists
    const oldPic = req.session.user.profile_pic;
    if (oldPic && oldPic !== "/uploads/default-avatar.png") {
      const oldPath = path.join("public", oldPic);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Update DB
    await db.query(
      "UPDATE users SET profile_pic = $1 WHERE id = $2",
      [newProfilePic, userId]
    );

    // Update session
    req.session.user.profile_pic = newProfilePic;

    res.redirect("/profile"); // or wherever you want
  } catch (err) {
    console.error("Error updating profile picture:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log("listening on port 3000");
});
 